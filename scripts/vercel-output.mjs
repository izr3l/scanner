import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? listFiles(join(directory, entry.name), `${prefix}${entry.name}/`)
    : `${prefix}${entry.name}`));
  return files.flat();
}

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Vercel reads vercel.json before running the build. Keep hashes in the build
// artifact instead, alongside the exact HTML from which they were calculated.
export async function writeVercelOutput(projectRoot, headers) {
  const root = resolve(projectRoot);
  const source = join(root, 'out');
  const output = join(root, '.vercel', 'output');
  if (!output.startsWith(root + sep)) throw new Error('Build output must stay inside the project.');
  const files = await listFiles(source);
  const pages = files.filter((file) => file === 'index.html' || file.endsWith('/index.html'));
  const routes = [
    { src: '/(.*)', headers, continue: true },
    { src: '/sw\\.js', headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }, continue: true },
  ];
  for (const page of pages) {
    const pathname = `/${page.slice(0, -'index.html'.length)}`;
    if (pathname !== '/') routes.push({ src: `^${escapePattern(pathname.slice(0, -1))}$`, headers: { Location: pathname }, status: 308 });
    routes.push({ src: `^${escapePattern(pathname)}$`, dest: `/${page}` });
  }
  routes.push({ handle: 'filesystem' }, { src: '/(.*)', dest: '/404.html', status: 404 });

  // Only the generated output directory is replaced; .vercel/project.json stays intact.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(source, join(output, 'static'), { recursive: true });
  await writeFile(join(output, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
}
