import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bundleLocal } from './bundle-local.mjs';
import { patchOpenCV } from './opencv-csp.mjs';
await import('./icons.mjs');
await mkdir('public/cv', { recursive: true });
await mkdir('app/fonts', { recursive: true });
const vendorStyles = [];
for (const name of ['vaul', 'sonner']) {
  const source = await readFile(`node_modules/${name}/dist/index.mjs`, 'utf8');
  const matches = [...source.matchAll(/__insertCSS\(("(?:[^"\\]|\\.)*")\);?/g)];
  if (matches.length !== 1) throw new Error(`Review ${name} CSS extraction after a dependency update.`);
  // Vaul 1.1.2 ships a stray colon in its fine-pointer hit-area rule.
  vendorStyles.push(JSON.parse(matches[0][1]).replace('[data-vaul-handle-hitarea]:{', '[data-vaul-handle-hitarea]{'));
}
await writeFile('app/vendor.css', vendorStyles.join('\n'));
for (const [name, slug] of [['syne', 'syne'], ['inter', 'inter'], ['jetbrains-mono', 'mono']]) {
  const dir = `node_modules/@fontsource-variable/${name}/files`;
  const filename = (await readdir(dir)).find((f) => f === `${name}-latin-wght-normal.woff2`);
  if (!filename) throw new Error(`Missing local ${name} font`);
  await copyFile(`${dir}/${filename}`, `app/fonts/${slug}.woff2`);
}
const cvSource = patchOpenCV(await readFile('node_modules/@techstark/opencv-js/dist/opencv.js', 'utf8'));
await writeFile('public/cv/opencv.js', cvSource);
// The engine and its embedded WASM are covered by the worker's one verified hash.
// Executing an imported blob script would conflict with script-src 'self'.
await bundleLocal('lib/cv/worker.ts', 'public/cv/worker.js', cvSource);
const integrity = {};
for (const path of ['/cv/worker.js']) integrity[path] = createHash('sha256').update(await readFile(`public${path}`)).digest('base64');
await writeFile('lib/asset-integrity.ts', `// Generated from pinned self-hosted runtime artifacts.\nexport const ASSET_INTEGRITY: Record<string, string> = ${JSON.stringify(integrity, null, 2)};\n`);
console.log('Prepared local fonts and integrity-checked CV assets.');
