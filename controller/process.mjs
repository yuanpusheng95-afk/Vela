import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// No shell, inherited model credentials, user Git configuration, or login startup files.
export function cleanEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  };
}

export async function command(bin, args, options = {}) {
  const { cwd, input, signal, timeoutMs = 60_000, maxBytes = 2_097_152,
    env = cleanEnv(), onSpawn, onOutput, binary = false } = options;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(bin, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    let stdout = '', stderr = '', bytes = 0, stopped = null, killTimer;
    const outputChunks = [], decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const stop = reason => {
      if (stopped) return;
      stopped = reason;
      const kill = sig => {
        try { process.platform !== 'win32' ? process.kill(-child.pid, sig) : child.kill(sig); } catch { /* already exited */ }
      };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1500);
      killTimer.unref();
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const consume = (stream, chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { stop('output_limit'); return; }
      if (binary && stream === 'stdout') outputChunks.push(chunk);
      const text = decoders[stream].write(chunk);
      if (stream === 'stdout') stdout += text; else stderr += text;
      onOutput?.(stream, text);
    };
    child.stdout.on('data', chunk => consume('stdout', chunk));
    child.stderr.on('data', chunk => consume('stderr', chunk));
    child.stdin.on('error', () => {}); // An early CLI exit may close stdin.
    child.on('spawn', () => onSpawn?.(child.pid));
    child.on('error', error => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); reject(error);
    });
    child.on('close', (code, exitSignal) => {
      if (stopped && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process group exited */ } }
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      stdout += decoders.stdout.end(); stderr += decoders.stderr.end();
      resolve({ code, signal: exitSignal, stopped, stdout, stderr, ...(binary ? { buffer: Buffer.concat(outputChunks) } : {}), durationMs: Date.now() - started });
    });
    child.stdin.end(input ?? '');
  });
}
