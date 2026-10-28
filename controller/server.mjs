import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, join, extname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller } from './controller.mjs';

export async function startServer(root, { port = 4317, controller: provided } = {}) {
  const controller = provided || await Controller.open(root);
  const dist = await realpath(join(root, 'dist'));
  const csrf = randomBytes(32).toString('hex');
  let activePromise = null;
  const server = createServer(async (req, res) => {
    const address = server.address();
    const host = `127.0.0.1:${address.port}`;
    const origin = `http://${host}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" };
    const send = (status, body) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    // Reject DNS rebinding and cross-origin requests. This local daemon is not a remotely callable worker.
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin)) { send(403, { error: 'origin_rejected' }); return; }
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        send(200, { ...await controller.snapshot(), source: 'local-controller', csrfToken: csrf }); return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const received = Buffer.from(String(req.headers['x-vela-token'] || ''));
        const expected = Buffer.from(csrf);
        if (req.headers.origin !== origin || received.length !== expected.length || !timingSafeEqual(received, expected)) { send(403, { error: 'token_required' }); return; }
        if (!req.headers['content-type']?.startsWith('application/json')) { send(415, { error: 'json_required' }); return; }
        let bodyText = '';
        for await (const chunk of req) { bodyText += chunk; if (Buffer.byteLength(bodyText) > 8192) { send(413, { error: 'body_limit' }); return; } }
        const body = JSON.parse(bodyText || '{}');
        if (url.pathname === '/api/runs') {
          if (activePromise) { send(409, { error: 'active_run' }); return; }
          activePromise = controller.run().then(() => controller.exportSnapshot()).catch(error => { console.error(`Vela run: ${error.message}`); }).finally(() => { activePromise = null; });
          send(202, { accepted: true }); return;
        }
        if (url.pathname === '/api/cancel') { controller.cancel(body.id); send(202, { accepted: true }); return; }
        if (url.pathname === '/api/direction') {
          if (typeof body.goal !== 'string' || body.goal.trim().length < 5 || body.goal.length > 1000
            || !Array.isArray(body.constraints) || body.constraints.length > 20 || body.constraints.some(value => typeof value !== 'string' || value.length > 1000)) {
            send(400, { error: 'invalid_direction' }); return;
          }
          const direction = controller.store.setDirection({ goal: body.goal.trim(), constraints: body.constraints });
          await controller.exportSnapshot(); send(200, direction); return;
        }
        send(404, { error: 'not_found' }); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { send(405, { error: 'method_not_allowed' }); return; }
      const path = resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      const actual = await realpath(path);
      const rel = relative(dist, actual);
      if (rel.startsWith('..') || isAbsolute(rel)) { send(403, { error: 'path_rejected' }); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
      const data = await readFile(actual);
      res.writeHead(200, { ...headers, 'Content-Type': `${types[extname(actual)] || 'application/octet-stream'}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error.code === 'ENOENT') send(404, { error: 'not_found' });
      else if (error instanceof SyntaxError) send(400, { error: 'invalid_json' });
      else send(409, { error: controller.runner.redact?.(error.message) || error.message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    server, controller, url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      controller.stop();
      await activePromise;
      await new Promise(resolve => server.close(resolve));
      if (!provided) controller.close();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const app = await startServer(resolve('.'), { port: Number(process.env.VELA_PORT || 4317) });
  console.log(`Vela 本地工作台：${app.url}（Ctrl+C 停止）`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
