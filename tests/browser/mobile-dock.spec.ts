import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';

// Match the deployed static artifact and its CSP, without a cached app shell.
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const destinations = [
  { id: 'home', name: 'Home workspace', label: 'Home', path: '/' },
  { id: 'scan', name: 'New scan', label: 'Scan', path: '/scan/' },
  { id: 'edit', name: 'Edit, refine & arrange', label: 'Edit', path: '/edit/' },
  { id: 'export', name: 'Export documents', label: 'Export', path: '/export/' },
  { id: 'settings', name: 'Settings', label: 'Settings', path: '/settings/' },
] as const;

const runtimeFailures = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  runtimeFailures.set(page, failures);
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.addInitScript(() => {
    const state = window as Window & { dockCspViolations?: string[] };
    state.dockCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      state.dockCspViolations!.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeFailures.get(page)).toEqual([]);
  expect(await page.evaluate(() => (window as Window & { dockCspViolations?: string[] }).dockCspViolations)).toEqual([]);
});

async function openWorkspace(page: Page) {
  await page.goto('/');
  const close = page.getByRole('button', { name: 'Close introduction', exact: true });
  await close.click();
  await expect(close).toHaveCount(0);
  return page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
}

async function assertSelection(dock: Locator, id: string) {
  await expect(dock).toHaveAttribute('data-active', id);
  await expect(dock.locator('[aria-current="page"]')).toHaveCount(1);
  const current = dock.locator('[aria-current="page"]');
  await expect(current).toHaveAttribute('href', destinations.find((item) => item.id === id)!.path);
  const indicator = dock.locator('.mobile-dock-selection');
  await expect(indicator).toHaveAttribute('aria-hidden', 'true');
  // Wait for the visual destination, including any spring/transition, not a fixed delay.
  await expect.poll(async () => {
    const [selected, pill, container] = await Promise.all([current.boundingBox(), indicator.boundingBox(), dock.boundingBox()]);
    if (!selected || !pill || !container) return false;
    return Math.abs(selected.x + selected.width / 2 - pill.x - pill.width / 2) <= 2
      && Math.abs(selected.y + selected.height / 2 - pill.y - pill.height / 2) <= 2
      && pill.x >= container.x && pill.x + pill.width <= container.x + container.width
      && pill.y >= container.y && pill.y + pill.height <= container.y + container.height;
  }).toBe(true);
}

async function assertGeometry(page: Page, dock: Locator) {
  await expect(dock).toBeVisible();
  const viewport = page.viewportSize()!;
  const bounds = (await dock.boundingBox())!;
  expect(bounds.height).toBeGreaterThanOrEqual(72);
  expect(bounds.x).toBeGreaterThanOrEqual(12);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 12);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 12);
  expect(bounds.y).toBeGreaterThan(0);
  const links = dock.getByRole('link');
  await expect(links).toHaveCount(5);
  let previousRight = bounds.x;
  for (const item of destinations) {
    const link = dock.getByRole('link', { name: item.name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveText(item.label);
    const hit = (await link.boundingBox())!;
    expect(hit.width, `${item.label} tap width at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
    expect(hit.height, `${item.label} tap height at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
    expect(hit.x).toBeGreaterThanOrEqual(previousRight - 1);
    expect(hit.x + hit.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(hit.y).toBeGreaterThanOrEqual(bounds.y);
    expect(hit.y + hit.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    const label = (await link.locator('span').last().boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(hit.x - 1);
    expect(label.x + label.width).toBeLessThanOrEqual(hit.x + hit.width + 1);
    previousRight = hit.x + hit.width;
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function assertSolidMaterial(dock: Locator) {
  const material = await dock.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d')!;
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return { alpha: context.getImageData(0, 0, 1, 1).data[3], backdrop: style.backdropFilter };
  });
  expect(material.alpha, 'Accessibility fallback must obscure the moving content beneath the dock').toBe(255);
  expect(material.backdrop).toBe('none');
}

test('mobile dock preserves its surface and selected destination across client navigation', async ({ page }) => {
  const dock = await openWorkspace(page);
  const surface = (await dock.elementHandle())!;
  await assertGeometry(page, dock);
  await assertSelection(dock, 'home');

  for (const item of destinations.filter((item) => item.id !== 'scan' && item.id !== 'home')) {
    await dock.getByRole('link', { name: item.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.path}$`));
    await assertSelection(dock, item.id);
    expect(await surface.evaluate((element) => element.isConnected && element === document.querySelector('.mobile-nav'))).toBe(true);
  }
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await dock.getByRole('link', { name: 'Home workspace', exact: true }).click();
  await assertSelection(dock, 'home');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await surface.evaluate((element) => element.isConnected)).toBe(true);

  // Ordinary links remain in the keyboard order and activate with Enter.
  await dock.getByRole('link', { name: 'Export documents', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dock.getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/$/);
  await assertSelection(dock, 'settings');
});

test('dock fits narrow phones and landscape without hiding tabs or shrinking touch targets', async ({ page }) => {
  const dock = await openWorkspace(page);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await assertGeometry(page, dock);
    await assertSelection(dock, 'home');
    // The persistent dock remains available while reading lower content.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await assertGeometry(page, dock);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  try {
    // Simulate a 200% default text size independently of viewport enlargement.
    await assertGeometry(page, dock);
    await assertSelection(dock, 'home');
  } finally {
    await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
  }
});

test('dock distinguishes text-entry keyboards from pinch zoom, including keyboard auto-zoom', async ({ page }) => {
  const dock = await openWorkspace(page);
  await dock.getByRole('link', { name: 'Settings', exact: true }).click();
  const watermark = page.getByRole('textbox', { name: /Default watermark/ });
  await watermark.focus();
  await expect(watermark).toBeFocused();
  expect(await page.evaluate(() => Boolean(window.visualViewport))).toBe(true);
  try {
    // A pure 2x pinch narrows the visual viewport without opening a keyboard.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, {
        height: { configurable: true, get: () => window.innerHeight / 2 },
        scale: { configurable: true, get: () => 2 },
      });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(dock).toBeVisible();

    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, {
        height: { configurable: true, get: () => window.innerHeight - 300 },
        scale: { configurable: true, get: () => 1 },
      });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(dock).toBeHidden();

    // Safari may zoom the focused field while the keyboard still occupies space.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, {
        height: { configurable: true, get: () => (window.innerHeight - 300) / 1.3 },
        scale: { configurable: true, get: () => 1.3 },
      });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(dock).toBeHidden();
  } finally {
    await watermark.blur();
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Reflect.deleteProperty(viewport, 'height');
      Reflect.deleteProperty(viewport, 'scale');
      viewport.dispatchEvent(new Event('resize'));
    });
  }
  await expect(dock).toBeVisible();
  await assertSelection(dock, 'settings');
});

test('dock has accessible light and dark appearances without SVG filter dependencies', async ({ page }) => {
  const dock = await openWorkspace(page);
  await dock.getByRole('link', { name: 'Settings', exact: true }).click();
  for (const theme of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await assertSelection(dock, 'settings');
    await page.screenshot({ path: `.qa/playwright/liquid-glass-mobile-${theme}.png` });
    const accessibility = await new AxeBuilder({ page }).include('.mobile-nav').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  }
  expect(await dock.evaluate((element) => [element, ...element.querySelectorAll('*')].some((node) =>
    ['', '::before', '::after'].some((pseudo) => {
      const style = getComputedStyle(node, pseudo || null);
      return /url\(/i.test(`${style.filter} ${style.backdropFilter}`);
    })))).toBe(false);
});

test('dock honors reduced motion, contrast, forced colors and reduced transparency', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dock = await openWorkspace(page);
  await dock.getByRole('link', { name: 'Settings', exact: true }).click();
  await assertSelection(dock, 'settings');
  expect(await dock.locator('.mobile-dock-selection').evaluate((element) => {
    const style = getComputedStyle(element);
    return style.transitionDuration.split(',').every((duration) => parseFloat(duration) === 0)
      && (style.animationName === 'none' || style.animationDuration.split(',').every((duration) => parseFloat(duration) === 0));
  })).toBe(true);

  // Chromium's Playwright contrast emulation is inconsistent between browser
  // channels. Set the media feature through CDP so CI and local Chromium runs
  // exercise the same fallback.
  const session = await context.newCDPSession(page);
  try {
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
    expect(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)).toBe(true);
    await assertSolidMaterial(dock);
    await page.emulateMedia({ contrast: 'no-preference', forcedColors: 'active' });
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'no-preference' }] });
    await assertSolidMaterial(dock);
    await assertSelection(dock, 'settings');

    await page.emulateMedia({ forcedColors: 'none' });
    // Playwright has no reduced-transparency option; Chromium exposes the CSS preference via CDP.
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
    await assertSolidMaterial(dock);
  } finally {
    await session.detach();
  }
});

test('dock leaves the camera unobstructed and yields to the desktop sidebar', async ({ page }) => {
  const dock = await openWorkspace(page);
  await dock.getByRole('link', { name: 'New scan', exact: true }).click();
  await expect(page).toHaveURL(/\/scan\/$/);
  await expect(page.locator('.mobile-nav')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Capture document', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
  await expect(dock).toBeVisible();
  await assertSelection(dock, 'home');
  await page.setViewportSize({ width: 851, height: 900 });
  await expect(page.locator('.mobile-nav')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
});

test('editor actions and install prompt remain above the mobile dock with a real document', async ({ page }) => {
  const dock = await openWorkspace(page);
  const buffer = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900"><rect width="700" height="900" fill="#252a30"/><rect x="80" y="70" width="540" height="760" fill="#fff"/><path d="M140 220H550M140 280H550M140 340H550M140 400H550M140 460H550M140 520H550M140 580H550M140 640H550" stroke="#222" stroke-width="12"/></svg>')).png().toBuffer();
  await page.getByLabel('Import document images', { exact: true }).setInputFiles({ name: 'dock-layout.png', mimeType: 'image/png', buffer });
  await expect(page).toHaveURL(/\/edit\/$/);
  await expect(page.getByRole('button', { name: /Top left crop corner/ })).toBeVisible();
  const actions = page.locator('.editor-mobile-actions');
  await actions.scrollIntoViewIfNeeded();
  await expect(actions).toBeVisible();
  await expect.poll(async () => {
    const [toolbar, navigation] = await Promise.all([actions.boundingBox(), dock.boundingBox()]);
    return Boolean(toolbar && navigation && toolbar.y + toolbar.height <= navigation.y - 8);
  }).toBe(true);
  await actions.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Crop your scan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close tools', exact: true }).click();
  await dock.getByRole('link', { name: 'Home workspace', exact: true }).click();
  // Simulate browser install availability; no install is initiated by this test.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
  const install = page.getByRole('button', { name: 'Install for offline scanning', exact: true });
  await expect(install).toBeVisible();
  await expect.poll(async () => {
    const [prompt, navigation] = await Promise.all([install.boundingBox(), dock.boundingBox()]);
    return Boolean(prompt && navigation && prompt.y + prompt.height <= navigation.y - 8);
  }).toBe(true);
});
