import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeVercelOutput } from '../scripts/vercel-output.mjs';
import { securityHeaders } from '../scripts/headers.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vaultscan-vercel-'));
  roots.push(root);
  for (const directory of ['out/scan', 'out/settings', 'out/cv', '.vercel']) await mkdir(join(root, directory), { recursive: true });
  for (const file of ['index.html', 'scan/index.html', 'settings/index.html', '404.html', 'sw.js', 'scan/__next.scan.__PAGE__.txt', 'cv/worker.js']) {
    await writeFile(join(root, 'out', file), `current build: ${file}`);
  }
  await writeFile(join(root, '.vercel/project.json'), '{"projectId":"keep-existing-link"}');
  await writeFile(join(root, 'vercel.json'), '{"version":2,"framework":null}');
  return root;
}

test('packages current security headers, static navigation routes and final worker bytes', async () => {
  const root = await fixture();
  const headers = securityHeaders(['current-build-hash']);
  await writeVercelOutput(root, headers);
  const config = JSON.parse(await readFile(join(root, '.vercel/output/config.json'), 'utf8'));
  expect(config.version).toBe(3);
  expect(config.routes[0]).toEqual({ src: '/(.*)', headers, continue: true });
  expect(headers['Content-Security-Policy']).not.toContain("'unsafe-inline'");
  expect(config.routes).toContainEqual({ src: '/sw\\.js', headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }, continue: true });
  for (const pathname of ['/', '/scan/', '/settings/']) {
    const route = config.routes.find((entry: { src?: string; dest?: string }) => entry.dest && entry.src && new RegExp(entry.src).test(pathname));
    expect(route?.dest).toBe(`${pathname}index.html`);
  }
  expect(config.routes).toContainEqual({ src: '^/scan$', headers: { Location: '/scan/' }, status: 308 });
  expect(config.routes.slice(-2)).toEqual([{ handle: 'filesystem' }, { src: '/(.*)', dest: '/404.html', status: 404 }]);
  for (const file of ['sw.js', 'cv/worker.js', 'scan/__next.scan.__PAGE__.txt']) {
    expect(await readFile(join(root, '.vercel/output/static', file), 'utf8')).toBe(`current build: ${file}`);
  }
  expect(await readFile(join(root, '.vercel/project.json'), 'utf8')).toContain('keep-existing-link');
  expect(await readFile(join(root, 'vercel.json'), 'utf8')).toBe('{"version":2,"framework":null}');
});

test('a rebuild replaces stale assets and CSP without rewriting source configuration', async () => {
  const root = await fixture();
  await writeVercelOutput(root, securityHeaders(['old-hash']));
  await writeFile(join(root, '.vercel/output/static/old-build.js'), 'stale');
  await writeFile(join(root, 'out/index.html'), 'new build HTML');
  await writeVercelOutput(root, securityHeaders(['new-hash']));
  const config = await readFile(join(root, '.vercel/output/config.json'), 'utf8');
  expect(config).toContain('sha256-new-hash');
  expect(config).not.toContain('sha256-old-hash');
  expect(await readFile(join(root, '.vercel/output/static/index.html'), 'utf8')).toBe('new build HTML');
  await expect(readFile(join(root, '.vercel/output/static/old-build.js'))).rejects.toMatchObject({ code: 'ENOENT' });
});
