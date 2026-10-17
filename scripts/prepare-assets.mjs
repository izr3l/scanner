import { mkdir, readdir, copyFile, readFile, writeFile, cp, rm } from 'node:fs/promises';
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
await mkdir('public/pdf', { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf/pdf.worker.min.mjs');
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${directory}`, `public/pdf/${directory}`, { recursive: true });
await copyFile('node_modules/pdfjs-dist/LICENSE', 'public/pdf/LICENSE');
await mkdir('public/ocr/lang', { recursive: true });
await rm('public/ocr/Inter.woff2', { force: true });
// Embedding the core and WASM prevents runtime script imports/CDN fallbacks.
const ocrCore = await readFile('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'utf8');
let ocrWorker = (await readFile('node_modules/tesseract.js/dist/worker.min.js', 'utf8')).replace(/\/\/# sourceMappingURL=.*$/m, '');
// Webpack's legacy global fallback generates JS. Modern supported browsers have globalThis.
const globalFallback = 'r.g=function(){if("object"==typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(t){if("object"==typeof window)return window}}()';
if (!ocrWorker.includes(globalFallback)) throw new Error('Review the pinned OCR worker global adapter after upgrading.');
ocrWorker = ocrWorker.replace(globalFallback, 'r.g=globalThis');
if (/\beval\s*\(|\bnew\s+Function\b/.test(ocrCore + ocrWorker)) throw new Error('Review the OCR engine for strict-CSP compatibility after upgrading.');
await writeFile('public/ocr/worker.js', `${ocrCore}\n;globalThis.TesseractCore = TesseractCore;\n${ocrWorker}`);
await copyFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', 'public/ocr/LiberationSans-Regular.ttf');
await copyFile('node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION', 'public/ocr/LICENSE-font.txt');
await copyFile('node_modules/tesseract.js/LICENSE.md', 'public/ocr/LICENSE-tesseract.md');
await copyFile('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt', 'public/ocr/LICENSE-worker.txt');
await copyFile('node_modules/tesseract.js-core/LICENSE', 'public/ocr/LICENSE-core');
for (const language of ['eng', 'fra']) await copyFile(`node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`, `public/ocr/lang/${language}.traineddata.gz`);
for (const path of ['/cv/worker.js', '/ocr/worker.js', '/ocr/LiberationSans-Regular.ttf', '/ocr/lang/eng.traineddata.gz', '/ocr/lang/fra.traineddata.gz']) integrity[path] = createHash('sha256').update(await readFile(`public${path}`)).digest('base64');
await writeFile('lib/asset-integrity.ts', `// Generated from pinned self-hosted runtime artifacts.\nexport const ASSET_INTEGRITY: Record<string, string> = ${JSON.stringify(integrity, null, 2)};\n`);
console.log('Prepared local fonts, PDF renderer, and integrity-checked CV/OCR assets.');
