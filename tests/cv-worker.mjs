import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const vendor = await readFile('public/cv/opencv.js');
const worker = await readFile('public/cv/worker.js');
const vendorHash = createHash('sha256').update(vendor).digest('base64');
const workerHash = createHash('sha256').update(worker).digest('base64');
await mkdir('.qa', { recursive: true });
const strictCsp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'";
const csp = strictCsp;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.url === '/cv/opencv.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(vendor); }
  else if (req.url === '/cv/worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(worker); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>CV worker verification</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') browserErrors.push(event.text()); });
  await page.goto(`http://127.0.0.1:${port}`);
  const result = await page.evaluate(async ({ vendorHash, workerHash, filter }) => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective + ': ' + event.blockedURI));
    const code = await (await fetch('/cv/worker.js')).arrayBuffer();
    const digest = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', code))));
    if (digest !== workerHash) throw new Error('Worker integrity mismatch.');
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const policy = trustedTypes.createPolicy('vaultscan-cv-worker-test', { createScriptURL(value) {
      if (value !== url) throw new Error('Wrong worker URL.');
      return value;
    } });
    const worker = new Worker(policy.createScriptURL(url));
    const requests = new Map();
    let id = 0;
    worker.onmessage = event => {
      const request = requests.get(event.data.id);
      if (event.data.ok) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error));
      requests.delete(event.data.id);
    };
    worker.onerror = event => { for (const request of requests.values()) request.reject(new Error(event.message)); };
    const call = payload => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker request timed out.')), 90_000);
      const requestId = ++id;
      requests.set(requestId, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
      worker.postMessage({ ...payload, id: requestId });
    });
    try {
      await call({ action: 'warm', vendorUrl: location.origin + '/cv/opencv.js', integrity: vendorHash });
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = 4000; canvas.height = 3000;
      const context = canvas.getContext('2d');
      context.fillStyle = '#202020'; context.fillRect(0, 0, 4000, 3000);
      const corners = [{ x: 200, y: 200 }, { x: 3800, y: 150 }, { x: 3650, y: 2800 }, { x: 150, y: 2850 }];
      context.beginPath(); corners.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath();
      context.fillStyle = '#eee'; context.fill();
      context.fillStyle = '#303030';
      for (let y = 500; y < 2400; y += 200) context.fillRect(600, y, 2300, 22);
      const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const started = performance.now();
      const detection = await call({ action: 'detect', source: original, mode: 'document' });
      const detectMs = performance.now() - started;
      if (detection.fallback) throw new Error('Synthetic document fell back to manual crop.');
      const page = { id: 'test', type: 'document', createdAt: 0, original, width: 4000, height: 3000, corners: detection.corners, recipe: { filter: filter || 'document', brightness: filter ? 0 : 5, contrast: filter ? 0 : 10, sharpness: filter ? 0 : 25, rotation: 90, flipX: true }, redactions: [] };
      const renderStarted = performance.now();
      const output = await call({ action: 'render', page });
      const renderMs = performance.now() - renderStarted;
      const bitmap = await createImageBitmap(output);
      const outputWidth = bitmap.width, outputHeight = bitmap.height;
      bitmap.close(); canvas.width = 0; canvas.height = 0;
      if (outputWidth < 2400 || outputHeight < 3200) throw new Error('Full resolution was lost.');
      return { outputWidth, outputHeight, bytes: output.size, detectMs, renderMs, confidence: detection.confidence, quality: detection.quality, violations };
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, { vendorHash, workerHash, filter: process.env.CV_FILTER }).catch(error => { console.error(JSON.stringify(browserErrors)); throw error; });
  if (result.violations.length || browserErrors.length) throw new Error(JSON.stringify({ result, browserErrors }));
  await writeFile('.qa/cv-worker-evidence.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
