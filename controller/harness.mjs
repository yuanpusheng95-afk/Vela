import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { command, cleanEnv } from './process.mjs';
import { hash } from './repository.mjs';

export const CONTRACT = 'dsh-headless-ndjson-v1';
export class HarnessRunner {
  constructor(root, version, credentials = process.env) {
    this.root = root;
    this.version = version;
    this.credentials = credentials;
    this.bin = resolve(root, 'runtime/harness/node_modules/@deepseek-ai/dsh/lib/bin.js');
  }
  redact(text) {
    const key = this.credentials.DEEPSEEK_API_KEY;
    return (key ? String(text).split(key).join('[REDACTED]') : String(text))
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
  }
  async preflight() {
    const blockers = [];
    let installedVersion = null, lockHash = null;
    try {
      installedVersion = JSON.parse(await readFile(join(dirname(this.bin), '../package.json'), 'utf8')).version;
      await access(this.bin);
      if (installedVersion !== this.version) blockers.push({ code: 'runtime_version', message: `需要 Harness ${this.version}，当前为 ${installedVersion}。` });
      lockHash = hash(await readFile(join(this.root, 'runtime/harness/package-lock.json')));
    } catch { blockers.push({ code: 'runtime_missing', message: '尚未安装固定版本 Harness，请在本地运行 npm run harness:install。' }); }
    if (!this.credentials.DEEPSEEK_API_KEY?.trim()) blockers.push({ code: 'model_credentials', message: '等待本地 DEEPSEEK_API_KEY；凭据不通过网页或聊天提交。' });
    return { engine: 'deepseek-harness', contract: CONTRACT, expectedVersion: this.version, installedVersion, lockHash, ready: !blockers.length, blockers };
  }
  async probe(stateDir) {
    const home = join(stateDir, 'probe-home');
    await mkdir(home, { recursive: true, mode: 0o700 });
    const env = cleanEnv({ HOME: home, DSH_HOME: home, DSH_PERMISSION_MODE: 'workspace-write' });
    const result = await command(process.execPath, [this.bin, '--profile', 'headless', '--help'], { cwd: home, env, timeoutMs: 30_000 });
    const passed = result.code === 0 && result.stdout.includes('--json') && result.stdout.includes('--session-id');
    const report = { at: new Date().toISOString(), version: this.version, contract: CONTRACT, passed,
      code: result.code, detail: this.redact(passed ? '固定版本 headless 已启动；JSON 事件和会话标识选项存在。未调用模型。' : result.stderr || result.stopped || result.stdout) };
    await writeFile(join(stateDir, 'harness-probe.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  }
  async execute({ workspace, runDir, prompt, signal, policy, onEvent, onSpawn }) {
    const ready = await this.preflight();
    if (!ready.ready) throw new Error(`runner_blocked: ${ready.blockers.map(x => x.code).join(', ')}`);
    const home = join(runDir, 'home');
    await mkdir(home, { recursive: true, mode: 0o700 });
    // Pin the permission boundary. No SDK-server process or user profile is reused.
    const env = cleanEnv({ HOME: home, DSH_HOME: home, TMPDIR: home,
      GIT_CEILING_DIRECTORIES: workspace, DSH_PERMISSION_MODE: 'workspace-write',
      DEEPSEEK_API_KEY: this.credentials.DEEPSEEK_API_KEY });
    let pending = '', events = [], malformed = false;
    const result = await command(process.execPath, [this.bin, '--profile', 'headless', '--json', '-'], {
      cwd: workspace, env, input: prompt, signal, timeoutMs: policy.maxRunSeconds * 1000,
      maxBytes: policy.maxOutputBytes, onSpawn,
      onOutput: (stream, text) => {
        if (stream !== 'stdout') return;
        pending += text;
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(this.redact(line));
            if (typeof event.type !== 'string') throw new Error('event_type');
            events.push(event); onEvent?.(event);
          } catch { malformed = true; }
        }
      },
    });
    if (pending.trim()) malformed = true;
    await writeFile(join(runDir, 'stdout.jsonl'), this.redact(result.stdout), { mode: 0o600 });
    await writeFile(join(runDir, 'stderr.log'), this.redact(result.stderr), { mode: 0o600 });
    const final = events.findLast(event => event.type === 'final');
    const session = events[0];
    return { code: result.code, stopped: result.stopped, durationMs: result.durationMs,
      protocolValid: !malformed && session?.type === 'session' && typeof session.sessionId === 'string' && !!session.sessionId
        && events.filter(event => event.type === 'session').length === 1 && events.filter(event => event.type === 'final').length === 1
        && events.at(-1) === final && typeof final?.text === 'string',
      final, eventCount: events.length, error: this.redact(result.stderr).slice(-1200) };
  }
}
