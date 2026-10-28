import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { command } from './process.mjs';
import { git, inspectRepository, assertClean, hash } from './repository.mjs';

// External bootstrap provenance is deliberately separate from autonomous runs.
export async function recordBootstrap(controller, baseSha) {
  if (!/^[a-f0-9]{40}$/.test(baseSha || '')) throw new Error('exact_bootstrap_base_required');
  const root = controller.root, before = await inspectRepository(root);
  assertClean(before);
  await git(root, ['merge-base', '--is-ancestor', baseSha, before.head]);
  const checks = [];
  for (const [name, args] of [
    ['控制器与 Git 闭环回归', ['--test', '--test-reporter=tap', resolve(root, 'tests/controller.test.mjs')]],
    ['工作台工程检查', [resolve(root, 'controller/verify-ui.mjs'), root]],
  ]) {
    const result = await command(process.execPath, args, { cwd: root, timeoutMs: 60_000, maxBytes: 1_048_576 });
    const report = name.includes('回归') ? {
      tests: Number(result.stdout.match(/^# tests (\d+)/m)?.[1] || 0),
      passed: Number(result.stdout.match(/^# pass (\d+)/m)?.[1] || 0),
      failed: Number(result.stdout.match(/^# fail (\d+)/m)?.[1] || 0),
    } : JSON.parse(result.stdout || '{}');
    checks.push({ name, passed: result.code === 0 && !result.stopped, durationMs: result.durationMs, report, logHash: hash(result.stdout) });
    await writeFile(join(controller.stateDir, `bootstrap-${checks.length}.log`), result.stdout + result.stderr, { mode: 0o600 });
  }
  if (checks.some(check => !check.passed)) throw new Error('bootstrap_verification_failed');
  const after = await inspectRepository(root); assertClean(after);
  if (before.head !== after.head) throw new Error('bootstrap_source_changed');
  const stat = await git(root, ['diff', '--numstat', '--no-ext-diff', '--no-textconv', baseSha, before.head]);
  const changedFiles = stat.trim().split('\n').filter(Boolean).map(line => { const [added, removed, ...path] = line.split('\t'); return { path: path.join('\t'), added: /^\d+$/.test(added) ? Number(added) : null, removed: /^\d+$/.test(removed) ? Number(removed) : null }; });
  const body = { schemaVersion: 1, engine: 'external-codex', kind: 'bootstrap', title: '建立本地最小控制器与真实记录界面',
    status: 'engineering_verified', at: new Date().toISOString(), baseSha, codeSha: before.head, checks, changedFiles,
    provenance: '由当前外部 Codex 助手完成引导开发；不是 Harness 自主运行。', deployment: 'separately_tracked', productOutcome: 'unmeasured' };
  const report = { ...body, evidenceHash: hash(JSON.stringify(body)) };
  await writeFile(join(controller.stateDir, 'bootstrap-evidence.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}
