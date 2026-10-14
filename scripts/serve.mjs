import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
const root = resolve('out');
const headers = JSON.parse(await readFile(resolve(root, 'security-headers.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    let missing = false;
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); } catch { missing = true; file = resolve(root, '404.html'); }
    const body = await readFile(file);
    const compressed = /\b(?:gzip)\b/.test(req.headers['accept-encoding'] || '') && ['.js','.html','.css','.txt','.json','.svg','.wasm'].includes(extname(file));
    const payload = compressed ? gzipSync(body) : body;
    const extra = pathname === '/sw.js' ? { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } : {};
    res.writeHead(missing ? 404 : 200, { ...headers, ...extra, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': payload.length, ...(compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : payload);
  } catch { res.writeHead(500); res.end('Unable to serve app'); }
}).listen(port, '0.0.0.0', () => console.log(`Vaultscan strict-CSP preview: http://localhost:${port}`));
