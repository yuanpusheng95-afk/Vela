import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../controller/store.mjs';
import { Controller } from '../controller/controller.mjs';
import { HarnessRunner } from '../controller/harness.mjs';
import { git } from '../controller/repository.mjs';
import { command } from '../controller/process.mjs';
import { startServer } from '../controller/server.mjs';
import { verifyUI } from '../controller/verify-ui.mjs';
import { inspectRepository } from '../controller/repository.mjs';

const policy = {
  schemaVersion: 1, projectId: 'test', name: 'Fixture', direction: 'Improve a fixture', constraints: ['Fixture only'],
  allowedPrefixes: ['dist/'], allowedFiles: ['README.md'], protectedFiles: ['dist/self-development.json'],
  maxRunSeconds: 5, maxOutputBytes: 20000, maxChangedFiles: 12, maxDiffBytes: 524288,
  harnessVersion: '0.2.1-rc.3', verification: 'frozen-ui-v1',
};
async function fixture(t, execute) {
  const root = await mkdtemp(join(tmpdir(), 'vela-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, '.gitignore'), '.vela/\n');
  await writeFile(join(root, 'dist/index.html'), '<html><script src="./shell-ui.js"></script></html>');
  await writeFile(join(root, 'dist/shell-ui.js'), ['renderShellSidebar', 'renderConversationWorkspace', 'renderDock', 'pluginsPage', 'automationPage'].map(name => `function ${name}(){}`).join('\n'));
  await git(root, ['init', '--quiet', '-b', 'main']);
  await git(root, ['add', '.']);
  await git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Fixture baseline']);
  const runner = {
    preflight: async () => ({ engine: 'fixture-test', contract: 'fixture-only', installedVersion: 'fixture', lockHash: 'fixture', ready: true, blockers: [] }),
    execute: async input => { await (execute || (async ({ workspace }) => writeFile(join(workspace, 'dist/feature.js'), 'const answer = 42;\n')))(input); return { code: 0, protocolValid: true, eventCount: 0, durationMs: 1 }; },
  };
  const c = await Controller.open(root, { policy, runner });
  t.after(() => c.close());
  return { root, c, runner, head: (await git(root, ['rev-parse', 'HEAD'])).trim() };
}

test('durable state and status/event updates survive reopening and reject stale transitions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vela-db-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite');
  let s = new Store(path);
  const d = s.setDirection({ goal: 'Direction', constraints: [] });
  const run = s.create({ directionVersion: d.version, engine: 'fixture-test' });
  assert.throws(() => s.create({ directionVersion: d.version }), /active_run/);
  assert.throws(() => s.setDirection({ goal: 'Changed', constraints: [] }), /active_run/);
  s.update(run.id, 'preparing', 'failed', 'run.failed', { failure: 'fixture' });
  assert.throws(() => s.update(run.id, 'preparing', 'executing', 'bad'), /state_conflict/);
  s.close(); s = new Store(path);
  assert.equal(s.get(run.id).status, 'failed');
  assert.deepEqual(s.events(run.id).map(e => e.kind), ['run.created', 'run.failed']);
  assert.equal(s.direction().version, 1); s.close();
});

test('real Git candidate → independent checkout verification → fast-forward, fixture excluded from autonomy metrics', async t => {
  const { c, root, head } = await fixture(t);
  const run = await c.run();
  assert.equal(run.status, 'integrated');
  assert.notEqual(run.candidateSha, head);
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), run.candidateSha);
  assert.equal(await readFile(join(root, 'dist/feature.js'), 'utf8'), 'const answer = 42;\n');
  assert.ok(run.evidenceHash && run.diffHash);
  const evidence = JSON.parse(await readFile(join(root, '.vela/runs', run.id, 'evidence.json')));
  assert.equal(evidence.candidateSha, run.candidateSha);
  assert.equal(evidence.baseSha, head);
  assert.ok(evidence.report.checks.every(check => check.passed));
  const snapshot = await c.exportSnapshot();
  assert.equal(snapshot.metrics.integrated, 0);
  assert.equal(snapshot.runs[0].engine, 'fixture-test');
  assert.ok(!JSON.stringify(snapshot).includes('candidatePath'));
  assert.ok(!JSON.stringify(snapshot).includes('workspaceRoot'));
  assert.deepEqual(c.store.events(run.id).filter(e => e.kind.startsWith('integration.')).map(e => e.kind), ['integration.started', 'integration.completed']);
});

test('syntax errors fail independent verification without changing source', async t => {
  const { c, root, head } = await fixture(t, ({ workspace }) => writeFile(join(workspace, 'dist/feature.js'), 'const = broken;'));
  const run = await c.run();
  assert.equal(run.status, 'failed');
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), head);
  assert.ok(run.verification.checks.some(check => !check.passed));
  assert.match(run.failure, /JavaScript/);
  const log = await readFile(join(root,'.vela/runs',run.id,'verification.log'),'utf8');
  assert.match(log, /SyntaxError/);
  assert.ok(!(await c.diagnostics(run.id)).verificationLog.includes('DEEPSEEK_API_KEY='));
});

test('validator accepts a canonical-equivalent linked root and still rejects escaping assets', async t => {
  const { root } = await fixture(t);
  const dir=await mkdtemp(join(tmpdir(),'vela-linked-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const alias=join(dir,'project'); await symlink(root,alias,'dir');
  assert.equal((await verifyUI(alias)).passed,true);
  await writeFile(join(dir,'outside.js'),'const secret=1;');
  await symlink(join(dir,'outside.js'),join(root,'dist/outside.js'));
  await writeFile(join(root,'dist/index.html'),'<script src="./outside.js"></script>');
  await assert.rejects(verifyUI(alias),/invalid_asset/);
});

test('ZIP or a nested parent repository has an explicit blocked state, never operates on its parent', async t => {
  const { root,head,runner }=await fixture(t);
  const child=join(root,'zip-download');await mkdir(join(child,'dist'),{recursive:true});await writeFile(join(child,'dist/index.html'),'<html>ZIP</html>');
  const c=await Controller.open(child,{policy,runner});
  try{
    assert.equal((await inspectRepository(child)).state,'uninitialized');
    const app=await startServer(child,{port:0,controller:c});
    try{const response=await fetch(app.url+'/api/snapshot'),snapshot=await response.json();assert.equal(response.status,200);assert.equal(snapshot.source,'local-controller');assert.equal(snapshot.repository.state,'uninitialized');assert.equal(snapshot.runtime.ready,false);}finally{await app.close();}
    c.shuttingDown=false;
    const run=await c.run();assert.equal(run.status,'blocked');assert.ok(run.blockers.some(b=>b.message.includes('上级 Git 仓库')));
    assert.equal((await git(root,['rev-parse','HEAD'])).trim(),head);
  }finally{c.close();}
});

test('legacy run details restore useful model/tool output, hide reasoning and support paging', async t => {
  const {c,root}=await fixture(t);
  const run=c.store.create({directionVersion:c.store.direction().version,engine:'fixture-test',baseSha:'old'});
  const raw=[{type:'session',sessionId:'old-session'},{type:'thinking',text:'private-reasoning-do-not-export'},{type:'text',text:'## 方案\n保留错误详情。'},{type:'tool_call',callId:'call-1',tool:'bash',input:{command:'npm test'}},{type:'tool_result',callId:'call-1',status:'error',result:'SyntaxError sk-fixturecredential1234567890'},{type:'final',text:'候选已实现，等待验证。'}];
  for(const event of raw)c.store.record(run.id,'harness.'+event.type,{type:event.type});
  c.store.update(run.id,'preparing','failed','verification.failed',{failure:'invalid_asset: ./styles.css',verification:{passed:false,error:'invalid_asset: ./styles.css'}});
  const dir=join(root,'.vela/runs',run.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'stdout.jsonl'),raw.map(e=>JSON.stringify(e)).join('\n')+'\n');
  await writeFile(join(dir,'stderr.log'),'diagnostic Bearer fixture-private-token');
  const detail=await c.runDetails(run.id,{limit:3});assert.equal(detail.events.length,3);assert.equal(detail.hasMore,true);
  const older=await c.runDetails(run.id,{limit:100,before:detail.beforeSeq});assert.ok(older.events.every(e=>e.seq<detail.beforeSeq));
  const diagnostic=await c.diagnostics(run.id),text=JSON.stringify(diagnostic);
  assert.ok(!text.includes('private-reasoning-do-not-export'));assert.ok(!text.includes('sk-fixturecredential'));assert.match(text,/REDACTED/);
  assert.ok(!text.includes('fixture-private-token'));
  assert.equal(diagnostic.events.find(e=>e.kind==='harness.tool_result').payload.tool,'bash');
  assert.match(diagnostic.events.find(e=>e.kind==='harness.text').payload.text,/方案/);
  const exported=await c.snapshot();assert.ok(!JSON.stringify(exported).includes('npm test'));
  const app=await startServer(root,{port:0,controller:c});
  try{const response=await fetch(app.url+`/api/runs/${run.id}/diagnostics`);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal((await response.json()).run.failure,'invalid_asset: ./styles.css');}finally{await app.close();}
});

test('tampered verification evidence cannot authorize integration', async t => {
  const { c, root, head } = await fixture(t);
  const integrateRun = c.integrateRun.bind(c);
  c.integrateRun = async id => c.store.get(id);
  const run = await c.run();
  t.after(() => rm(run.workspaceRoot, { recursive: true, force: true }));
  assert.equal(run.status, 'validated');
  const path = join(root, '.vela/runs', run.id, 'evidence.json');
  const evidence = JSON.parse(await readFile(path, 'utf8'));
  evidence.report.passed = false;
  await writeFile(path, JSON.stringify(evidence));
  await assert.rejects(integrateRun(run.id), /evidence_mismatch/);
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), head);
});

test('candidate cannot change stable controller or generated evidence', async t => {
  for (const path of ['controller.mjs', 'dist/self-development.json']) {
    await t.test(path, async t => {
      const { c, root, head } = await fixture(t, ({ workspace }) => writeFile(join(workspace, path), 'forged'));
      const run = await c.run();
      assert.equal(run.status, 'failed'); assert.match(run.failure, /scope_violation/);
      assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), head);
    });
  }
});

test('uncommitted source blocks the model before it is called', async t => {
  let called = false;
  const { c, root } = await fixture(t, async () => { called = true; });
  await writeFile(join(root, 'dist/uncommitted.js'), 'const x=1;');
  const run = await c.run();
  assert.equal(run.status, 'blocked'); assert.equal(called, false);
  assert.match(run.blockers[0].message, /dirty_repository/);
});

test('concurrent source advance cannot be overwritten by a validated candidate', async t => {
  let newHead;
  const { c, root } = await fixture(t, async ({ workspace }) => {
    await writeFile(join(workspace, 'dist/feature.js'), 'const answer=42;');
    await writeFile(join(root, 'README.md'), 'Concurrent user change');
    await git(root, ['add', 'README.md']);
    await git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'Concurrent edit']);
    newHead = (await git(root, ['rev-parse', 'HEAD'])).trim();
  });
  const run = await c.run();
  assert.ok(['failed', 'interrupted'].includes(run.status)); assert.match(run.failure, /base_changed/);
  assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), newHead);
  assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'Concurrent user change');
});

test('cancellation ends an owned run; second controller cannot start another one', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { c, root, runner } = await fixture(t, async ({ signal }) => {
    started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  });
  const pending = c.run(); await ready;
  const other = await Controller.open(root, { policy, runner });
  try { await assert.rejects(other.run(), /active_run/); } finally { other.close(); }
  c.cancel(c.store.runs()[0].id);
  const run = await pending;
  assert.equal(run.status, 'cancelled');
  assert.ok(c.store.events(run.id).some(e => e.kind === 'cancel.requested'));
});

test('lost controller is reconciled as interrupted; live owner cannot be stolen', async t => {
  const { c } = await fixture(t);
  const d = c.store.direction();
  const run = c.store.create({ directionVersion: d.version, ownerPid: process.pid });
  await assert.rejects(c.recover(run.id), /owner_alive/);
  c.store.update(run.id, 'preparing', 'executing', 'fixture.lost', { ownerPid: 2147483647 });
  assert.equal((await c.recover(run.id)).status, 'interrupted');
  await assert.rejects(c.recover(run.id), /not_active/);
});

test('missing credentials fail preflight and secrets are redacted before recording', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vela-key-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runner = new HarnessRunner(dir, '0.2.1-rc.3', {});
  const report = await runner.preflight();
  assert.ok(report.blockers.some(x => x.code === 'model_credentials'));
  const privateRunner = new HarnessRunner(dir, '0.2.1-rc.3', { DEEPSEEK_API_KEY: 'test-private-value' });
  assert.equal(privateRunner.redact('failed test-private-value'), 'failed [REDACTED]');
  await assert.rejects(runner.execute({ workspace: dir, runDir: dir, policy }), /runner_blocked/);
});

test('subprocess has a bounded lifetime and preserves chunked UTF-8 output', async () => {
  const timed = await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30 });
  assert.equal(timed.stopped, 'timeout');
  const text = await command(process.execPath, ['-e', 'const b=Buffer.from("航向");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)']);
  assert.equal(text.stdout, '航向');
});

test('Runner contract uses stdin and validates NDJSON; raw credentials never enter saved logs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vela-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageDir = join(root, 'runtime/harness/node_modules/@deepseek-ai/dsh');
  await mkdir(join(packageDir, 'lib'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: policy.harnessVersion }));
  await writeFile(join(root, 'runtime/harness/package-lock.json'), '{}');
  const script = `const fs=require('node:fs'); const input=fs.readFileSync(0,'utf8');
    if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--profile','headless','--json','-']))process.exit(4);
    console.log(JSON.stringify({type:'session',sessionId:'fixture-session'}));
    console.error('diagnostic '+process.env.DEEPSEEK_API_KEY);
    console.log(JSON.stringify({type:'final',text:input}));`;
  await writeFile(join(packageDir, 'lib/bin.js'), script);
  const workspace = join(root, 'workspace'), runDir = join(root, 'logs');
  await mkdir(workspace); await mkdir(runDir);
  const runner = new HarnessRunner(root, policy.harnessVersion, { DEEPSEEK_API_KEY: 'fixture-private-value' });
  const prompt = 'Unicode 航向\n$(must_not_execute) `literal`';
  const result = await runner.execute({ workspace, runDir, prompt, policy });
  assert.equal(result.code, 0); assert.equal(result.protocolValid, true); assert.equal(result.final.text, prompt);
  const stderr = await readFile(join(runDir, 'stderr.log'), 'utf8');
  assert.ok(!stderr.includes('fixture-private-value')); assert.ok(stderr.includes('[REDACTED]'));
  await writeFile(join(packageDir, 'lib/bin.js'), 'console.log(JSON.stringify({type:"final",text:"missing session"}));');
  assert.equal((await runner.execute({ workspace, runDir, prompt, policy })).protocolValid, false);
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: '0.2.1-rc.4' }));
  assert.ok((await runner.preflight()).blockers.some(blocker => blocker.code === 'runtime_version'));
});

test('shutdown during preflight never starts a delayed model invocation', async t => {
  const { c, runner } = await fixture(t);
  let release;
  const original = runner.preflight;
  runner.preflight = () => new Promise(resolve => { release = async () => resolve(await original()); });
  const pending = c.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  c.stop(); await release();
  await assert.rejects(pending, /controller_stopping/);
  assert.equal(c.store.runs().length, 0);
});

test('local API enforces host/origin/token and exports no token to the static snapshot', async t => {
  const { c, root } = await fixture(t);
  const app = await startServer(root, { port: 0, controller: c });
  try {
    const response = await fetch(`${app.url}/api/snapshot`), snapshot = await response.json();
    assert.equal(snapshot.source, 'local-controller'); assert.equal(snapshot.csrfToken.length, 64);
    assert.equal((await fetch(`${app.url}/api/snapshot`, { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(`${app.url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: '{}' })).status, 403);
    const update = await fetch(`${app.url}/api/direction`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url, 'X-Vela-Token': snapshot.csrfToken }, body: JSON.stringify({ goal: 'A better fixture', constraints: [] }) });
    assert.equal(update.status, 200); assert.equal((await update.json()).version, 2);
    const exported = await readFile(join(root, 'dist/self-development.json'), 'utf8');
    assert.ok(!exported.includes('csrfToken')); assert.ok(!exported.includes(snapshot.csrfToken));
    assert.equal((await fetch(`${app.url}/package.json`)).status, 404);
    const started = await fetch(`${app.url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url, 'X-Vela-Token': snapshot.csrfToken }, body: '{}' });
    assert.equal(started.status, 202);
    let settled;
    for (let i=0;i<60;i++) {
      settled = (await (await fetch(`${app.url}/api/snapshot`)).json()).runs[0];
      if (settled && ['integrated','failed','blocked'].includes(settled.status)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(settled.status, 'integrated');
  } finally { await app.close(); }
});
