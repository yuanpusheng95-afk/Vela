import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, ACTIVE } from './store.mjs';
import { HarnessRunner } from './harness.mjs';
import { inspectRepository, assertClean, prepareWorkspace, captureCandidate, verificationCheckout, integrate, git, hash } from './repository.mjs';
import { command } from './process.mjs';
import { projectEvent, redactText } from './events.mjs';

const MODULE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const verifierFiles = ['verify-ui.mjs', 'process.mjs'];
const timestamp = () => new Date().toISOString();
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };

export class Controller {
  static async open(root, options = {}) {
    root = resolve(root);
    const policy = options.policy || JSON.parse(await readFile(join(root, 'controller/policy.json'), 'utf8'));
    const stateDir = options.stateDir || join(root, '.vela');
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const runner = options.runner || new HarnessRunner(root, policy.harnessVersion);
    const instance = new Controller(root, stateDir, policy, runner);
    if (!instance.store.direction()) instance.store.setDirection({ goal: policy.direction, constraints: policy.constraints });
    return instance;
  }
  constructor(root, stateDir, policy, runner) {
    this.root = root; this.stateDir = stateDir; this.policy = policy; this.runner = runner;
    this.store = new Store(join(stateDir, 'controller.sqlite'));
    this.running = new Map();
    this.shuttingDown = false;
    this.detailsCache = new Map();
    this.serviceError = null;
  }
  close() { this.store.close(); }
  async validatorHash() {
    return hash(Buffer.concat(await Promise.all(verifierFiles.map(path => readFile(join(MODULE_ROOT, path))))));
  }
  async doctor({ probe = false } = {}) {
    const preflight = await this.runner.preflight();
    const runtimeProbe = probe ? await this.runner.probe(this.stateDir) : await readFile(join(this.stateDir, 'harness-probe.json'), 'utf8').then(JSON.parse).catch(() => null);
    return { ...preflight, probe: runtimeProbe, nodeVersion: process.version };
  }
  prompt(direction) {
    return `你是航向 Vela 的自主研发执行者。人只提供长期方向，你负责先调查当前代码，再选择并完成一个最小、有价值、可验证的改进。
长期方向 v${direction.version}：${direction.goal}
边界：${direction.constraints.join('\n')}
这不是让你实施预先指定的需求。根据仓库现状自行判断本轮改进；无充分依据时如实说明，不编造用户反馈或业务指标。
本轮最多 ${this.policy.maxChangedFiles} 个文件，最多 ${this.policy.maxRunSeconds} 秒。只可修改 dist/ 下的产品文件与 README.md，禁止修改 dist/self-development.json。
工作区是从固定 Git SHA 导出的独立副本，没有 .git。不要初始化 Git、提交、修改控制器/测试/运行包、安装依赖、读取凭据文件、操作父目录或触发外部发布。
稳定控制器在你完成后单独捕获差异、运行冻结验证器并决定是否整合。不要伪造验证、交付或自主运行记录。
验收会检查 HTML 本地资源、JavaScript 语法，以及 shell-ui.js 的核心会话、插件和工具区入口。保持这些入口兼容；可在工作区运行 node controller/verify-ui.mjs . 预检，稳定控制器仍会另行验证。
${this.store.runs(3).filter(run => ['failed','interrupted'].includes(run.status)).map(run => `最近一次未通过的工作 ${run.id.slice(0,8)}：${run.failure || run.status}。失败项：${JSON.stringify(run.verification?.checks?.filter(check => !check.passed) || run.verification?.error || [])}`).join('\n')}
最后用简体中文简述：调查依据、选择理由、具体变更、验收方式与仍待验证之处。`;
  }
  async run() {
    if (this.shuttingDown) throw new Error('controller_stopping');
    const direction = this.store.direction(), repository = await inspectRepository(this.root);
    const preflight = await this.runner.preflight();
    if (this.shuttingDown) throw new Error('controller_stopping');
    const blockers = [...preflight.blockers];
    try { assertClean(repository); } catch (error) { blockers.push({ code: 'repository_not_ready', message: error.message }); }
    const data = {
      projectId: this.policy.projectId, directionVersion: direction.version,
      engine: preflight.engine, runtimeVersion: preflight.installedVersion,
      contract: preflight.contract, runtimeLockHash: preflight.lockHash,
      baseSha: repository.head, branch: repository.branch,
      policy: this.policy, policyHash: hash(JSON.stringify(this.policy)),
      validatorHash: await this.validatorHash(), blockers, ownerPid: process.pid,
    };
    const run = this.store.create(data, blockers.length ? 'blocked' : 'preparing');
    const id = run.id;
    if (blockers.length) {
      this.store.record(id, 'run.blocked', { blockers });
      return this.store.get(id);
    }
    const abort = new AbortController();
    this.running.set(id, abort);
    const runDir = join(this.stateDir, 'runs', id);
    let prepared;
    try {
      await mkdir(runDir, { recursive: true, mode: 0o700 });
      await writeFile(join(runDir, 'direction.json'), JSON.stringify(direction, null, 2), { mode: 0o600 });
      prepared = await prepareWorkspace(this.root, data.baseSha);
      this.store.update(id, 'preparing', 'executing', 'workspace.prepared', { workspaceRoot: prepared.root }, { baseSha: data.baseSha });
      const result = await this.runner.execute({ workspace: prepared.workspace, runDir, prompt: this.prompt(direction), signal: abort.signal, policy: this.policy,
        onSpawn: pid => this.store.record(id, 'runner.started', { pid }),
        onEvent: event => {
          const payload = projectEvent(event, text => this.runner.redact?.(text) || redactText(text));
          if (payload) this.store.record(id, `harness.${event.type}`, payload);
        },
      });
      if (abort.signal.aborted || result.stopped === 'cancelled') {
        return this.store.update(id, 'executing', 'cancelled', 'run.cancelled', { execution: { code: result.code, durationMs: result.durationMs } });
      }
      this.store.update(id, 'executing', 'executing', 'runner.exited', { summary: String(result.final?.text || '').slice(0, 12000), execution: { code: result.code, durationMs: result.durationMs, eventCount: result.eventCount, stopped: result.stopped } });
      if (result.code !== 0 || result.stopped || !result.protocolValid) throw new Error(result.stopped || result.error || 'runner_protocol_or_exit');
      this.store.update(id, 'executing', 'verifying', 'runner.completed', { summary: String(result.final?.text || '').slice(0, 12000), execution: { code: result.code, durationMs: result.durationMs, eventCount: result.eventCount } });
      const candidate = await captureCandidate(prepared, this.policy);
      if (!candidate) return this.store.update(id, 'verifying', 'no_change', 'candidate.empty');
      await writeFile(join(runDir, 'candidate.patch'), candidate.diff, { mode: 0o600 });
      this.store.update(id, 'verifying', 'verifying', 'candidate.captured', { candidateSha: candidate.sha, diffHash: candidate.diffHash, changedFiles: candidate.changed, candidatePath: prepared.candidate },
        { sha: candidate.sha, files: candidate.changed, diffHash: candidate.diffHash });
      const verificationPath = await verificationCheckout(prepared, candidate.sha);
      const verify = await command(process.execPath, [join(MODULE_ROOT, 'verify-ui.mjs'), verificationPath], {
        cwd: verificationPath, signal: abort.signal, timeoutMs: 60_000, maxBytes: 1_048_576,
      });
      const verificationLog = (this.runner.redact?.(verify.stdout + verify.stderr) || redactText(verify.stdout + verify.stderr)).split(verificationPath).join('<candidate>');
      await writeFile(join(runDir, 'verification.log'), verificationLog, { mode: 0o600 });
      if (abort.signal.aborted) return this.store.update(id, 'verifying', 'cancelled', 'run.cancelled');
      let report;
      try { report = JSON.parse(this.runner.redact?.(verify.stdout) || verify.stdout || '{}'); }
      catch { report = { passed: false, checks: [], error: '验证器未返回有效 JSON；请查看验证输出。' }; }
      report = JSON.parse(JSON.stringify(report).split(verificationPath).join('<candidate>'));
      const cleanVerification = !(await git(verificationPath, ['status', '--porcelain'])).trim();
      const verifiedHead = (await git(verificationPath, ['rev-parse', 'HEAD'])).trim();
      if (verify.code !== 0 || verify.stopped || !report.passed || !cleanVerification || verifiedHead !== candidate.sha) {
        const failedCheck = report.checks?.find(check => !check.passed);
        const failure = verify.stopped || report.error || (failedCheck ? `${failedCheck.name}：${failedCheck.detail || '检查未通过'}` : !cleanVerification ? '验证期间候选目录被修改' : verifiedHead !== candidate.sha ? '验证的代码版本与候选不一致' : '验证器退出异常');
        return this.store.update(id, 'verifying', 'failed', 'verification.failed', { verification: report, failure, failureStage: 'verifying', verificationExitCode: verify.code }, { checks: report.checks || [], error: failure });
      }
      const evidence = { schemaVersion: 1, at: timestamp(), baseSha: data.baseSha, candidateSha: candidate.sha,
        diffHash: candidate.diffHash, policyHash: data.policyHash, validatorHash: data.validatorHash,
        runtimeVersion: data.runtimeVersion, runtimeLockHash: data.runtimeLockHash, report,
        logHash: hash(verificationLog), verification: 'clean-checkout-frozen-ui-v1' };
      const evidenceText = JSON.stringify(evidence, null, 2);
      await writeFile(join(runDir, 'evidence.json'), evidenceText, { mode: 0o600 });
      this.store.update(id, 'verifying', 'validated', 'verification.passed', { verification: report, evidenceHash: hash(evidenceText) }, { candidateSha: candidate.sha, checks: report.checks, evidenceHash: hash(evidenceText) });
      if (abort.signal.aborted) return this.store.update(id, 'validated', 'cancelled', 'run.cancelled');
      return await this.integrateRun(id);
    } catch (error) {
      const current = this.store.get(id);
      if (current.status === 'integrating') {
        const repository = await inspectRepository(this.root);
        if (repository.head === current.candidateSha && repository.branch === current.branch) {
          return this.store.update(id, 'integrating', 'integrated', 'integration.reconciled', { integratedSha: repository.head, productOutcome: 'unmeasured', deployment: 'not_deployed' });
        }
        return this.store.update(id, 'integrating', 'interrupted', 'integration.uncertain', { failure: error.message });
      }
      if (ACTIVE.includes(current.status)) {
        return this.store.update(id, current.status, abort.signal.aborted ? 'cancelled' : 'failed', abort.signal.aborted ? 'run.cancelled' : 'run.failed', { failure: this.runner.redact?.(error.message) || error.message, failureStage: current.status });
      }
      throw error;
    } finally {
      this.running.delete(id);
      // Retain a validated/interrupted candidate for explicit reconciliation. Never discard its only copy.
      if (prepared && !['validated', 'integrating', 'interrupted'].includes(this.store.get(id).status)) await rm(prepared.root, { recursive: true, force: true });
    }
  }
  cancel(id) {
    const abort = this.running.get(id);
    if (!abort) throw new Error('not_owned: 此进程不拥有该执行，不能将它标记为已停止。');
    this.store.record(id, 'cancel.requested'); abort.abort();
  }
  stop() {
    this.shuttingDown = true;
    for (const id of this.running.keys()) this.cancel(id);
  }
  async integrateRun(id) {
    const run = this.store.get(id);
    if (run.status !== 'validated') throw new Error(`state_conflict: ${run.status}`);
    const evidenceText = await readFile(join(this.stateDir, 'runs', id, 'evidence.json'), 'utf8');
    const evidence = JSON.parse(evidenceText);
    if (hash(evidenceText) !== run.evidenceHash || evidence.candidateSha !== run.candidateSha || evidence.baseSha !== run.baseSha
      || evidence.policyHash !== hash(JSON.stringify(this.policy)) || evidence.validatorHash !== await this.validatorHash()
      || !evidence.report.passed || hash(await readFile(join(this.stateDir, 'runs', id, 'candidate.patch'))) !== run.diffHash) {
      throw new Error('evidence_mismatch');
    }
    const candidateHead = (await git(run.candidatePath, ['rev-parse', 'HEAD'])).trim();
    if (candidateHead !== run.candidateSha || (await git(run.candidatePath, ['status', '--porcelain'])).trim()) throw new Error('candidate_changed');
    this.store.update(id, 'validated', 'integrating', 'integration.started');
    const sha = await integrate(this.root, run);
    return this.store.update(id, 'integrating', 'integrated', 'integration.completed', { integratedSha: sha, productOutcome: 'unmeasured', deployment: 'not_deployed' }, { sha });
  }
  async recover(id) {
    const run = this.store.get(id);
    if (!ACTIVE.includes(run.status)) throw new Error('not_active');
    if (alive(run.ownerPid)) throw new Error('owner_alive: 不能接管仍存活的控制器。');
    if (run.status === 'integrating') {
      const repository = await inspectRepository(this.root);
      if (repository.head === run.candidateSha && repository.branch === run.branch) {
        return this.store.update(id, 'integrating', 'integrated', 'integration.reconciled', { integratedSha: repository.head, productOutcome: 'unmeasured', deployment: 'not_deployed' });
      }
    }
    // No automatic replay of a prompt or an uncertain Git integration.
    return this.store.update(id, run.status, 'interrupted', 'run.reconciled', { failure: 'controller_process_lost' });
  }
  publicRun(run, includeEvents = false) {
    const data = {
      id: run.id, status: run.status, engine: run.engine, directionVersion: run.directionVersion,
      runtimeVersion: run.runtimeVersion, baseSha: run.baseSha, candidateSha: run.candidateSha, summary: run.summary,
      integratedSha: run.integratedSha, createdAt: run.createdAt, updatedAt: run.updatedAt,
      blockers: run.blockers, failure: run.failure, failureStage: run.failureStage, changedFiles: run.changedFiles || [],
      verification: run.verification, verificationExitCode: run.verificationExitCode, execution: run.execution, evidenceHash: run.evidenceHash,
      diffHash: run.diffHash, deployment: run.deployment || 'not_deployed', productOutcome: 'unmeasured',
      eventCount: this.store.eventCount(run.id),
      // Exported snapshots retain controller evidence, not full model/tool logs. Local details are fetched on demand.
      events: includeEvents ? this.store.events(run.id).filter(event => !event.kind.startsWith('harness.')).slice(-50) : [],
    };
    return JSON.parse(this.runner.redact?.(JSON.stringify(data)) || redactText(JSON.stringify(data)));
  }
  async runDetails(id, { before = Infinity, limit = 100 } = {}) {
    const run = this.store.get(id), count = this.store.eventCount(id), key = `${run.updatedAt}:${count}`;
    let cached = this.detailsCache.get(id);
    if (cached?.key !== key) {
      let legacy = [];
      const path = join(this.stateDir, 'runs', id, 'stdout.jsonl');
      try {
        if ((await stat(path)).size <= 2_097_152) legacy = (await readFile(path, 'utf8')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      } catch { /* Existing runs may have no output file or still be executing. */ }
      const redact = text => this.runner.redact?.(text) || redactText(text);
      const calls = new Map(); let cursor = 0;
      const events = this.store.events(id).filter(event => event.kind !== 'harness.thinking').map(event => {
        if (!event.kind.startsWith('harness.')) return { ...event, payload: JSON.parse(redact(JSON.stringify(event.payload))) };
        const type = event.kind.slice(8), index = legacy.findIndex((entry, i) => i >= cursor && entry.type === type);
        const raw = index >= 0 ? legacy[index] : { ...event.payload, type };
        if (index >= 0) cursor = index + 1;
        const payload = projectEvent(raw, redact) || {};
        if (type === 'tool_call' && payload.callId) calls.set(payload.callId, payload.tool);
        if (type === 'tool_result') payload.tool = calls.get(payload.callId) || payload.tool || '';
        return { ...event, payload };
      });
      cached = { key, events }; this.detailsCache.set(id, cached);
      if (this.detailsCache.size > 8) this.detailsCache.delete(this.detailsCache.keys().next().value);
    }
    const available = cached.events.filter(event => event.seq < before), page = available.slice(-Math.min(200, Math.max(1, limit)));
    return { run: this.publicRun(run), events: page, totalEvents: cached.events.length, hasMore: available.length > page.length, beforeSeq: page[0]?.seq ?? null };
  }
  async diagnostics(id) {
    const data = await this.runDetails(id, { limit: 200 }), dir = join(this.stateDir, 'runs', id);
    const textFile = async name => {
      try { const text = await readFile(join(dir, name), 'utf8'); return (this.runner.redact?.(text) || redactText(text)).slice(0, 131072); }
      catch { return null; }
    };
    return { schemaVersion: 1, generatedAt: timestamp(), ...data, verificationLog: await textFile('verification.log'), stderr: await textFile('stderr.log') };
  }
  async snapshot({ includeEvents = true } = {}) {
    const repo = await inspectRepository(this.root), runtime = await this.doctor();
    if (repo.state !== 'ready') { runtime.ready = false; runtime.blockers.push({ code: 'repository_uninitialized', message: repo.message }); }
    const runs = this.store.runs().map(run => this.publicRun(run, includeEvents));
    const bootstrap = await readFile(join(this.stateDir, 'bootstrap-evidence.json'), 'utf8').then(JSON.parse).catch(() => null);
    return {
      schemaVersion: 1, generatedAt: timestamp(), source: 'controller-export',
      project: { id: this.policy.projectId, name: this.policy.name, repository: basename(this.root), direction: this.store.direction() },
      repository: { state: repo.state, message: repo.message, head: repo.head, branch: repo.branch, trackedFiles: repo.trackedFiles, uncommittedFiles: repo.changes.map(change => change.path), files: repo.files },
      runtime, runs, bootstrap, serviceError: this.serviceError,
      acceptance: { id: this.policy.verification, scope: '工程静态检查；浏览器行为、实际桌面资源占用与产品效果尚待验证', maxRunSeconds: this.policy.maxRunSeconds, maxChangedFiles: this.policy.maxChangedFiles,
        allowed: [...this.policy.allowedPrefixes, ...this.policy.allowedFiles], protected: this.policy.protectedFiles },
      metrics: { attempts: runs.length, integrated: runs.filter(run => run.status === 'integrated' && run.engine === 'deepseek-harness').length, productSuccess: null },
      limitations: ['这是第一轮本地控制器，尚未接入 Tauri 或原生 Harness 客户端。', '工程检查通过不代表产品有效；当前不自动发布。', 'Harness 版本固定，新版本先通过 Runner 合约检查后切换；已有记录保留原版本。'],
    };
  }
  async exportSnapshot(path = join(this.root, 'dist/self-development.json')) {
    const data = await this.snapshot(), temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o644 });
    await rename(temp, path); // Readers see an entire snapshot or its predecessor.
    return data;
  }
}
