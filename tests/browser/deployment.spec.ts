import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Exercise the exported HTTP responses instead of an already cached app shell.
test.use({ serviceWorkers: 'block' });

async function monitorStartup(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.addInitScript(() => {
    const state = window as Window & { deploymentCspViolations?: string[] };
    state.deploymentCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      state.deploymentCspViolations!.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  return async () => {
    expect(failures).toEqual([]);
    expect(await page.evaluate(() => (window as Window & { deploymentCspViolations?: string[] }).deploymentCspViolations)).toEqual([]);
  };
}

async function dismissIntroduction(page: Page) {
  const close = page.getByRole('button', { name: 'Close introduction', exact: true });
  await close.click();
  await expect(close).toHaveCount(0);
}

test('Vercel output ships CSP hashes with the exact exported HTML and service worker', async () => {
  const output = '.vercel/output';
  const config = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
  const headers = config.routes[0].headers as Record<string, string>;
  expect(headers).toEqual(JSON.parse(await readFile('out/security-headers.json', 'utf8')));
  expect(JSON.parse(await readFile('vercel.json', 'utf8'))).not.toHaveProperty('headers');
  const policy = headers['Content-Security-Policy'];
  const scriptPolicy = policy.split(';').find((directive) => directive.trim().startsWith('script-src '));
  expect(scriptPolicy).toBeDefined();

  async function htmlFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => entry.isDirectory()
      ? htmlFiles(join(directory, entry.name))
      : entry.name.endsWith('.html') ? [join(directory, entry.name)] : []));
    return files.flat();
  }
  const pages = await htmlFiles(join(output, 'static'));
  expect(pages.length).toBeGreaterThan(0);
  let inlineScripts = 0;
  for (const file of pages) {
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (!match[1]) continue;
      inlineScripts++;
      const hash = createHash('sha256').update(match[1]).digest('base64');
      expect(scriptPolicy, `Bootstrap script in ${file} must be allowed by its deployment CSP`).toContain(`'sha256-${hash}'`);
    }
  }
  expect(inlineScripts).toBeGreaterThan(0);
  const [deployedWorker, exportedWorker] = await Promise.all([
    readFile(join(output, 'static/sw.js')),
    readFile('out/sw.js'),
  ]);
  expect(Buffer.compare(deployedWorker, exportedWorker)).toBe(0);
});

test('Vercel routes redirect page URLs and serve missing pages and service worker headers', async ({ request }) => {
  for (const path of ['/scan', '/settings']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(`${path}/`);
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    const page = await request.get(`${path}/`);
    expect(page.status()).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
  }
  const [missing, worker] = await Promise.all([
    request.get('/missing-deployment-route/'),
    request.get('/sw.js'),
  ]);
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('text/html');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['cache-control']).toBe('no-cache');
  expect(worker.headers()['service-worker-allowed']).toBe('/');
});

test('exported app keeps sidebar navigation and settings interactive', async ({ page }) => {
  const assertStartup = await monitorStartup(page);
  await page.goto('/');
  await dismissIntroduction(page);
  const sidebar = page.locator('.sidebar');
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const settings = sidebar.getByRole('link', { name: 'Settings', exact: true });

  await settings.click();
  await expect(page).toHaveURL(/\/settings\/$/);
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const autoCapture = page.getByRole('switch', { name: 'Auto-capture', exact: true });
  await expect(autoCapture).toBeChecked();
  await autoCapture.click();
  await expect(autoCapture).not.toBeChecked();
  const watermark = page.getByRole('textbox', { name: /Default watermark/ });
  await watermark.fill('DEPLOYMENT CHECK');
  await expect(watermark).toHaveValue('DEPLOYMENT CHECK');

  for (const [name, path, heading] of [
    ['Workspace', '/', 'Start with a scan'],
    ['Refine & arrange', '/edit/', 'A fresh start.'],
    ['Export', '/export/', 'Something worth sharing.'],
  ] as const) {
    const link = navigation.getByRole('link', { name, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await navigation.getByRole('link', { name: /^New scan/ }).click();
  await expect(page).toHaveURL(/\/scan\/$/);
  await expect(page.getByRole('button', { name: 'Auto-capture', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/$'));
  await settings.click();
  // Settings survive every client navigation, including entering and leaving the camera.
  await expect(watermark).toHaveValue('DEPLOYMENT CHECK');
  await expect(autoCapture).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await sidebar.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await assertStartup();
});

test('fresh exported routes hydrate and the camera displays and captures video', async ({ page }) => {
  const assertStartup = await monitorStartup(page);
  for (const [path, heading] of [
    ['/', 'Start with a scan'],
    ['/settings/', 'Privacy & settings'],
    ['/edit/', 'A fresh start.'],
    ['/export/', 'Something worth sharing.'],
  ] as const) {
    await page.goto(path);
    await dismissIntroduction(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await assertStartup();
  }

  await page.goto('/scan/');
  await dismissIntroduction(page);
  const autoCapture = page.getByRole('button', { name: 'Auto-capture', exact: true });
  if (await autoCapture.getAttribute('aria-pressed') === 'true') await autoCapture.click();
  const video = page.getByLabel('Live camera view', { exact: true });
  await expect.poll(() => video.evaluate((element) => {
    const source = element as HTMLVideoElement;
    const stream = source.srcObject as MediaStream | null;
    return source.videoWidth > 0 && source.videoHeight > 0 && source.readyState >= 2
      && !source.paused && stream?.getVideoTracks().some((track) => track.readyState === 'live');
  })).toBe(true);
  const shutter = page.getByRole('button', { name: 'Capture document', exact: true });
  await expect(shutter).toBeEnabled({ timeout: 90_000 });
  await shutter.click();
  await expect(page).toHaveURL(/\/edit\/$/);
  await expect(page.getByRole('button', { name: /Top left crop corner/ })).toBeVisible();
  await assertStartup();
});
