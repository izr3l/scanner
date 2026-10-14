import { build } from 'esbuild';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
const require = createRequire(import.meta.url);
const workspace = resolve('.');
// Let JavaScript resolve only known project/package files. The native compiler
// receives source text through its plugin interface and never scans parent dirs.
export async function bundleLocal(entry, outfile, banner = '') {
  const result = await build({
    entryPoints: [entry], write: false, bundle: true, minify: true,
    platform: 'browser', format: 'iife', target: 'es2022', tsconfigRaw: {},
    banner: { js: banner },
    plugins: [{ name: 'workspace-only-resolver', setup(builder) {
      builder.onResolve({ filter: /.*/ }, async (args) => {
        const base = args.importer ? dirname(args.importer) : workspace;
        const target = args.kind === 'entry-point' || args.path.startsWith('.')
          ? resolve(base, args.path)
          : require.resolve(args.path, { paths: [base] });
        if (!target.startsWith(workspace + sep)) throw new Error('Worker dependency must stay inside the project.');
        for (const file of [target, `${target}.ts`, `${target}.js`, `${target}.mjs`, resolve(target, 'index.ts'), resolve(target, 'index.js')]) {
          try { if ((await stat(file)).isFile()) return { path: file, namespace: 'project-source' }; } catch { /* Try the next explicit suffix. */ }
        }
        throw new Error(`Missing worker module: ${args.path}`);
      });
      builder.onLoad({ filter: /.*/, namespace: 'project-source' }, async (args) => ({ contents: await readFile(args.path, 'utf8'), loader: args.path.endsWith('.ts') ? 'ts' : 'js' }));
    } }],
  });
  await writeFile(outfile, result.outputFiles[0].contents);
}
