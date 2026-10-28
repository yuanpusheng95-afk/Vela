import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command } from './process.mjs';

// The controller invokes this stable file by absolute path, never candidate npm scripts.
export async function verifyUI(target) {
  const root = resolve(target), dist = join(root, 'dist'), checks = [];
  const inside = path => { const p = relative(dist, path); return !p.startsWith('..') && !isAbsolute(p); };
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
    .filter(value => value.startsWith('./') || (!value.includes(':') && !value.startsWith('#') && !value.startsWith('/')));
  for (const ref of refs) {
    const path = resolve(dist, ref.split(/[?#]/)[0]);
    if (!inside(path) || !inside(await realpath(path)) || !(await lstat(path)).isFile()) throw new Error(`invalid_asset: ${ref}`);
  }
  checks.push({ name: '入口与本地资源引用', passed: refs.length > 0, detail: `${refs.length} 个资源存在` });
  const scripts = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('symlink_in_dist');
      if (entry.isDirectory()) await walk(file); else if (/\.(?:m?js)$/.test(entry.name)) scripts.push(file);
    }
  }
  await walk(dist);
  for (const file of scripts) {
    const result = await command(process.execPath, ['--check', file], { cwd: root, timeoutMs: 10_000 });
    checks.push({ name: `JavaScript · ${relative(root, file)}`, passed: result.code === 0 && !result.stopped, detail: result.code === 0 ? '语法检查通过' : result.stderr.slice(0, 1200) });
  }
  const source = await readFile(join(dist, 'shell-ui.js'), 'utf8');
  checks.push({ name: '既有会话、插件与工具区入口', passed: ['renderShellSidebar', 'renderConversationWorkspace', 'renderDock', 'pluginsPage', 'automationPage'].every(name => source.includes(`function ${name}(`)), detail: '稳定验证器检查核心界面入口仍存在；不替代浏览器验收' });
  return { passed: checks.every(check => check.passed), checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { const report = await verifyUI(process.argv[2] || '.'); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1; }
  catch (error) { console.log(JSON.stringify({ passed: false, error: error.message })); process.exitCode = 1; }
}
