import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const html = await readFile('out/index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)].filter((match) => !(match[1] + match[3]).includes('noModule'));
const assets = [];
for (const match of scripts) { const bytes = await readFile(`out${match[2]}`); assets.push({ url: match[2], gzipBytes: gzipSync(bytes).length }); }
const report = { initialModernJavaScriptGzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0), assets, note: 'JavaScript only; excludes CSS, HTML, fonts, legacy nomodule polyfills and lazy CV/editor/export chunks.' };
console.log(JSON.stringify(report, null, 2));
await writeFile('.qa/shell-size.json', JSON.stringify(report, null, 2));
