import { readFile, readdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bundleLocal } from './bundle-local.mjs';
import { injectManifest } from '@serwist/build';
import { securityHeaders } from './headers.mjs';
async function walk(dir) { const entries = await readdir(dir, { withFileTypes: true }); const children = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : `${dir}/${entry.name}`)); return children.flat(); }
const hashes = new Set();
// The engine is embedded in the verified worker. Avoid shipping it twice.
await rm('out/cv/opencv.js', { force: true });
// Next's segment-prefetch URLs use dots; static exports emit nested directories.
// Emit portable aliases so any static host can serve those requests directly.
for (const file of (await walk('out')).filter((file) => file.endsWith('.txt'))) {
  const marker = file.indexOf('/__next.');
  if (marker < 0) continue;
  const alias = file.slice(0, marker + 1) + file.slice(marker + 1).replaceAll('/', '.');
  if (alias !== file) await copyFile(file, alias);
}
for (const file of (await walk('out')).filter((file) => file.endsWith('.html'))) {
  let html = await readFile(file, 'utf8');
  // This narrow policy loads before Next's bootstrap and only accepts same-origin app scripts.
  if (!html.includes('<script src="/trusted-policy.js"></script>')) html = html.replace('<head>', '<head><script src="/trusted-policy.js"></script>');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (match[1]) hashes.add(createHash('sha256').update(match[1]).digest('base64'));
  await writeFile(file, html);
}
const headers = securityHeaders([...hashes]);
await writeFile('out/_headers', `/*\n${Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`).join('\n')}\n`);
await writeFile('out/security-headers.json', JSON.stringify(headers, null, 2));
await writeFile('vercel.json', JSON.stringify({ version: 2, buildCommand: 'npm run build', outputDirectory: 'out', framework: null, headers: [{ source: '/(.*)', headers: Object.entries(headers).map(([key, value]) => ({ key, value })) }] }, null, 2));
await bundleLocal('sw.ts', 'out/sw.js');
const sw = await injectManifest({ swSrc: 'out/sw.js', swDest: 'out/sw.js', globDirectory: 'out', globPatterns: ['**/*.{html,js,mjs,css,woff2,png,svg,webmanifest,txt,wasm,bcmap,pfb,ttf,gz}'], globIgnores: ['sw.js', 'security-headers.json'], maximumFileSizeToCacheInBytes: 20 * 1024 * 1024, modifyURLPrefix: { '': '/' } });
console.log(`Static export secured; ${sw.count} app assets precached (${(sw.size / 1024 / 1024).toFixed(1)} MB). Scans are never cached.`);
