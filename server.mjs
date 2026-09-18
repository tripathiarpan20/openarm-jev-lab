import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, validateScene } from './jev.mjs';
import { MODEL } from './public/world.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const configured = !!token && /^[a-f\d]{32}$/i.test(accountId ?? '');
const port = Number(process.env.PORT || 4317);
let busy = false;
let lastCall = 0;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'" };
  function json(status, value) { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(403, { error: 'Local access only.' });
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (req.method === 'GET' && pathname === '/api/status') return json(200, { model: MODEL, configured,
    message: configured ? 'Jev is configured. Each decision calls Cloudflare.' : 'Waiting for CLOUDFLARE_ACCOUNT_ID in the server .env file.' });
  if (req.method === 'POST' && pathname === '/api/decide') {
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(403, { error: 'Origin not allowed.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required.' });
    if (!configured) return json(503, { error: 'Add your Cloudflare account ID to the server .env file, then restart. No model call was made.' });
    if (busy || Date.now() - lastCall < 700) return json(429, { error: 'A decision is already running. Please wait a moment.' });
    busy = true;
    try {
      let body = ''; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 24000) { json(413, { error: 'Scene too large.' }); return; }
        body += chunk;
      }
      let scene;
      try { scene = validateScene(JSON.parse(body)); } catch (e) { return json(400, { error: e.message }); }
      lastCall = Date.now();
      const result = await decide(scene, { token, accountId });
      json(200, result);
    } catch (e) {
      json(502, { error: e.name === 'TimeoutError' ? 'Jev timed out. The arm is paused; retry when ready.' : e.message.startsWith('Cloudflare') || e.message.startsWith('Jev ') ? e.message : 'Could not reach Jev. The arm is paused; check the server network connection.' });
    } finally { busy = false; }
    return;
  }
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  let file;
  if (pathname === '/vendor/three.module.js') file = path.join(root, 'node_modules/three/build/three.module.js');
  else if (pathname === '/vendor/three.core.js') file = path.join(root, 'node_modules/three/build/three.core.js');
  else if (pathname === '/vendor/OrbitControls.js') file = path.join(root, 'node_modules/three/examples/jsm/controls/OrbitControls.js');
  else if (pathname === '/vendor/RoundedBoxGeometry.js') file = path.join(root, 'node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js');
  else if (/^\/[a-zA-Z0-9_-]+\.(html|js|css|svg)$/.test(pathname) || pathname === '/') file = path.join(root, 'public', pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file) return json(404, { error: 'Not found.' });
  try { const data = await readFile(file); res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { json(404, { error: 'Not found.' }); }
});
server.requestTimeout = 35000;
server.listen(port, '127.0.0.1', () => console.log(`OpenArm × Jev lab: http://127.0.0.1:${port}\nModel: ${MODEL}\nJev configuration: ${configured ? 'ready' : 'account ID required'}`));
