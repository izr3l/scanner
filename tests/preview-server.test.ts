import { afterEach, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from '../scripts/headers.mjs';
import { writeVercelOutput } from '../scripts/vercel-output.mjs';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill(); });
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function buildFixture(root: string, vercel: boolean, version: string) {
  const script = `globalThis.buildVersion = '${version}';`;
  const hash = createHash('sha256').update(script).digest('base64');
  const headers = securityHeaders([hash]);
  await mkdir(join(root, 'out'), { recursive: true });
  await writeFile(join(root, 'out/index.html'), `<html><body><script>${script}</script></body></html>`);
  await writeFile(join(root, 'out/security-headers.json'), JSON.stringify(headers));
  if (vercel) await writeVercelOutput(root, headers);
  return `'sha256-${hash}'`;
}

async function startPreview(root: string, vercel: boolean, port: number) {
  const script = fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, ...(vercel ? ['--vercel'] : [])], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`Preview startup timed out: ${errors}`)), 10_000);
    child.stderr?.on('data', (chunk) => { errors += chunk.toString(); });
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes(`http://localhost:${port}`)) { clearTimeout(timer); resolve(); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Preview exited (${code}): ${errors}`)); });
  });
  return child;
}

test.each([false, true])('preview keeps HTML and CSP aligned across rebuilds (Vercel artifact: %s)', async (vercel) => {
  const root = await mkdtemp(join(tmpdir(), 'vaultscan-preview-'));
  roots.push(root);
  const firstHash = await buildFixture(root, vercel, 'first');
  const port = await availablePort();
  const child = await startPreview(root, vercel, port);
  const first = await fetch(`http://127.0.0.1:${port}/`);
  expect(first.status).toBe(200);
  expect(await first.text()).toContain("buildVersion = 'first'");
  expect(first.headers.get('content-security-policy')).toContain(firstHash);

  const nextHash = await buildFixture(root, vercel, 'rebuilt');
  const next = await fetch(`http://127.0.0.1:${port}/`);
  expect(child.exitCode).toBeNull();
  expect(next.status).toBe(200);
  const html = await next.text();
  expect(html).toContain("buildVersion = 'rebuilt'");
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(inlineScript).toBeDefined();
  const servedHash = `'sha256-${createHash('sha256').update(inlineScript!).digest('base64')}'`;
  expect(servedHash).toBe(nextHash);
  expect(next.headers.get('content-security-policy')).toContain(servedHash);
  expect(next.headers.get('content-security-policy')).not.toContain(firstHash);
}, 20_000);
