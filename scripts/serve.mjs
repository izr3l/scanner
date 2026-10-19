import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
const vercelOutput = process.argv.includes('--vercel');
const root = resolve(vercelOutput ? '.vercel/output/static' : 'out');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    // A preview can stay running across builds. Read the current policy/routes
    // with each response so new HTML never uses CSP hashes held from startup.
    const deployment = vercelOutput ? JSON.parse(await readFile(resolve('.vercel/output/config.json'), 'utf8')) : null;
    const headers = deployment ? {} : JSON.parse(await readFile(resolve(root, 'security-headers.json'), 'utf8'));
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    let status = 200;
    let responseHeaders = { ...headers };
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (deployment) {
      // Interpret the Build Output routes used by this static app, including
      // redirects and the filesystem boundary, so tests exercise the artifact.
      for (const route of deployment.routes) {
        if (route.handle === 'filesystem') {
          try { if ((await stat(file)).isFile()) break; } catch { /* Continue to the emitted 404 route. */ }
          continue;
        }
        if (!new RegExp(`^(?:${route.src})$`).test(pathname)) continue;
        responseHeaders = { ...responseHeaders, ...route.headers };
        if (route.continue) continue;
        status = route.status ?? 200;
        if (route.dest) file = resolve(root, `.${route.dest}`);
        else { res.writeHead(status, responseHeaders); res.end(); return; }
        break;
      }
    } else {
      try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); } catch { status = 404; file = resolve(root, '404.html'); }
    }
    const body = await readFile(file);
    const compressed = /\b(?:gzip)\b/.test(req.headers['accept-encoding'] || '') && ['.js','.mjs','.html','.css','.txt','.json','.svg','.wasm'].includes(extname(file));
    const payload = compressed ? gzipSync(body) : body;
    const extra = !deployment && pathname === '/sw.js' ? { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } : {};
    res.writeHead(status, { ...responseHeaders, ...extra, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': payload.length, ...(compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : payload);
  } catch { res.writeHead(500); res.end('Unable to serve app'); }
}).listen(port, '0.0.0.0', () => console.log(`Vaultscan strict-CSP ${vercelOutput ? 'Vercel artifact ' : ''}preview: http://localhost:${port}`));
