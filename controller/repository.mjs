import { mkdir, readFile, writeFile, rm, readdir, lstat, mkdtemp, chmod, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { command, cleanEnv } from './process.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
const gitArgs = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false'];
export async function git(cwd, args, input) {
  const result = await command('git', [...gitArgs, ...args], { cwd, input, maxBytes: 16_777_216 });
  if (result.code !== 0 || result.stopped) throw new Error(`git_failed: ${result.stderr.trim().slice(0, 800)}`);
  return result.stdout;
}
export async function inspectRepository(repo) {
  const root = await realpath(repo);
  const top = await git(repo, ['rev-parse', '--show-toplevel']).then(value => realpath(value.trim())).catch(() => null);
  if (!top || top !== root) {
    return { state: 'uninitialized', head: null, branch: null, changes: [], trackedFiles: 0, files: [],
      message: top ? '当前目录属于上级 Git 仓库。请在本目录建立独立基线后运行。' : '当前目录没有 Git 基线。ZIP 下载不包含 Git 历史。' };
  }
  const hasHead = await git(repo, ['rev-parse', '--verify', 'HEAD']).catch(() => '');
  if (!hasHead.trim()) return { state: 'uninitialized', head: null, branch: null, changes: [], trackedFiles: 0, files: [], message: 'Git 仓库尚无首次提交。请先建立源码基线。' };
  const head = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const branch = (await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
  const status = await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const changes = [];
  const parts = status.split('\0');
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const code = parts[i].slice(0, 2), path = parts[i].slice(3);
    changes.push({ code, path });
    if (code.includes('R') || code.includes('C')) i++;
  }
  const files = (await git(repo, ['ls-tree', '-r', '--name-only', 'HEAD'])).trim().split('\n').filter(Boolean);
  return { state: 'ready', head, branch, changes, trackedFiles: files.length, files };
}
export function assertClean(snapshot) {
  if (snapshot.state === 'uninitialized') throw new Error(`repository_uninitialized: ${snapshot.message}`);
  const dirty = snapshot.changes.filter(change => change.path !== 'dist/self-development.json');
  if (dirty.length) throw new Error(`dirty_repository: ${dirty.map(x => x.path).join(', ')}`);
  if (!snapshot.branch) throw new Error('detached_source: 源仓库必须有可快进的当前分支。');
}
export async function scan(directory, prefix = '') {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const files = new Map();
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const info = await lstat(join(directory, path));
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error(`unsupported_file: ${path}`);
    if (info.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.vela') throw new Error(`forbidden_directory: ${path}`);
      for (const [p, item] of await scan(directory, path)) files.set(p, item);
    } else {
      if (info.size > 4_194_304) throw new Error(`file_too_large: ${path}`);
      const content = await readFile(join(directory, path));
      files.set(path, { content, hash: hash(content), mode: info.mode & 0o111 ? 0o755 : 0o644 });
    }
    if (files.size > 5000) throw new Error('too_many_files');
  }
  return files;
}
export async function prepareWorkspace(repo, baseSha) {
  const root = await mkdtemp(join(tmpdir(), 'vela-run-'));
  const workspace = join(root, 'workspace');
  const candidate = join(root, 'candidate');
  await mkdir(workspace, { mode: 0o700 });
  try {
    const tree = (await git(repo, ['ls-tree', '-r', '-z', baseSha])).split('\0').filter(Boolean);
    for (const entry of tree) {
      const [header, path] = entry.split('\t'), [mode, type, blob] = header.split(' ');
      if (type !== 'blob' || !['100644', '100755'].includes(mode) || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsupported_tree: ${path}`);
      const result = await command('git', [...gitArgs, 'cat-file', 'blob', blob], { cwd: repo, maxBytes: 4_194_304, binary: true });
      if (result.code || result.stopped) throw new Error(`source_read_failed: ${path}`);
      await mkdir(dirname(join(workspace, path)), { recursive: true });
      await writeFile(join(workspace, path), result.buffer, { mode: mode === '100755' ? 0o755 : 0o644 });
    }
    await git(repo, ['clone', '--no-hardlinks', '--no-checkout', '--quiet', repo, candidate]);
    await git(candidate, ['remote', 'remove', 'origin']);
    await git(candidate, ['checkout', '--detach', '--quiet', baseSha]);
    return { root, workspace, candidate, baseline: await scan(workspace) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
export function allowed(path, policy) {
  return !policy.protectedFiles.includes(path) && (policy.allowedFiles.includes(path) || policy.allowedPrefixes.some(prefix => path.startsWith(prefix)))
    && !path.split('/').some(part => part === '.git' || part === '.env' || part.startsWith('.env.'));
}
export async function captureCandidate(prepared, policy) {
  const after = await scan(prepared.workspace);
  const changed = [...new Set([...prepared.baseline.keys(), ...after.keys()])]
    .filter(path => prepared.baseline.get(path)?.hash !== after.get(path)?.hash || prepared.baseline.get(path)?.mode !== after.get(path)?.mode);
  if (changed.length > policy.maxChangedFiles) throw new Error('change_file_limit');
  for (const path of changed) if (!allowed(path, policy)) throw new Error(`scope_violation: ${path}`);
  for (const path of changed) {
    const target = join(prepared.candidate, path), item = after.get(path);
    if (!item) await rm(target, { force: true });
    else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, item.content, { mode: item.mode }); await chmod(target, item.mode); }
  }
  if (!changed.length) return null;
  await git(prepared.candidate, ['add', '--all']);
  const diff = await git(prepared.candidate, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary']);
  if (Buffer.byteLength(diff) > policy.maxDiffBytes) throw new Error('diff_limit');
  await git(prepared.candidate, ['-c', 'user.name=Vela Controller', '-c', 'user.email=vela@localhost', 'commit', '--quiet', '-m', 'Vela: autonomous scoped UI improvement']);
  const sha = (await git(prepared.candidate, ['rev-parse', 'HEAD'])).trim();
  return { sha, changed, diff, diffHash: hash(diff) };
}
export async function verificationCheckout(prepared, candidateSha) {
  const path = join(prepared.root, 'verification');
  await git(prepared.candidate, ['clone', '--no-hardlinks', '--no-checkout', '--quiet', prepared.candidate, path]);
  await git(path, ['remote', 'remove', 'origin']);
  await git(path, ['checkout', '--quiet', '--detach', candidateSha]);
  return path;
}
export async function integrate(repo, run) {
  const before = await inspectRepository(repo);
  assertClean(before);
  if (before.head !== run.baseSha || before.branch !== run.branch) throw new Error('base_changed: 源分支已变化，必须重新验证。');
  await git(repo, ['fetch', '--quiet', '--no-tags', run.candidatePath, run.candidateSha]);
  // Recheck after fetch. Git's own locked ref update additionally rejects a concurrent writer.
  const current = await inspectRepository(repo);
  assertClean(current);
  if (current.head !== run.baseSha || current.branch !== run.branch) throw new Error('base_changed');
  await git(repo, ['merge', '--ff-only', '--no-edit', run.candidateSha]);
  const head = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  if (head !== run.candidateSha) throw new Error('integration_head_mismatch');
  return head;
}
