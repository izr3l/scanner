import { expect, test, type Download, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function scannedPdf() {
  const pdf = await PDFDocument.create();
  pdf.setAuthor('PRIVATE SOURCE AUTHOR');
  for (const title of ['HELLO VAULTSCAN', 'SECOND PAGE']) {
    const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#f8f7f3"/><g fill="#141414" font-family="Arial" font-size="46"><text x="130" y="180">${title}</text><text x="130" y="280">Readable document 2026</text><text x="130" y="600">SECRET TOKEN</text><text x="130" y="850">Clear letters for everyone.</text><text x="130" y="960">Café français</text></g></svg>`)).png().toBuffer();
    const embedded = await pdf.embedPng(image);
    pdf.addPage([540, 720]).drawImage(embedded, { width: 540, height: 720 });
  }
  return Buffer.from(await pdf.save());
}

async function downloadBytes(download: Download, mode: string) {
  const path = `.qa/playwright/ocr-${mode}-${download.suggestedFilename()}`;
  await download.saveAs(path);
  return readFile(path);
}

async function extractText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    return pages;
  } finally { await task.destroy(); }
}

async function recognize(page: Page) {
  await page.getByRole('button', { name: /^(Recognize text|Retry text recognition)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Review recognized text' })).toBeVisible({ timeout: 120_000 });
}

test('scanned PDF import, redacted offline OCR, searchable and clean text exports', async ({ page, context }) => {
  test.setTimeout(300_000);
  const failures: string[] = [];
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push({ url: request.url(), method: request.method(), body: request.postData() }); });
  await page.addInitScript(() => {
    const state = window as Window & { ocrCspViolations?: string[] };
    state.ocrCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => state.ocrCspViolations!.push(`${event.violatedDirective}: ${event.blockedURI}`));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Close introduction' }).click();
  await expect(page.getByText('Offline-ready', { exact: false }).first()).toBeVisible({ timeout: 120_000 });
  // Both the PDF renderer and the OCR engine/models must work with no network.
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Close introduction' }).click();
  const input = await scannedPdf();
  expect((await extractText(input)).join('')).toBe('');
  await page.getByLabel('Import document images').setInputFiles({ name: 'private-scanned-document.pdf', mimeType: 'application/pdf', buffer: input });
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.getByRole('button', { name: 'Edit page 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await expect(page.getByAltText('Enhanced document preview')).toBeVisible();
  await page.getByRole('button', { name: /\bProtect$/ }).click();
  await page.getByRole('button', { name: 'Add rectangle with keyboard' }).click();
  await page.getByRole('spinbutton', { name: 'Redaction 1 left in percent' }).fill('5');
  await page.getByRole('spinbutton', { name: 'Redaction 1 top in percent' }).fill('32');
  await page.getByRole('spinbutton', { name: 'Redaction 1 width in percent' }).fill('90');
  await page.getByRole('spinbutton', { name: 'Redaction 1 height in percent' }).fill('10');
  // Imported PDF selects its last page. Redact the same private field on the first page too.
  await page.getByRole('button', { name: 'Edit page 1', exact: true }).click();
  await page.getByRole('button', { name: 'Add rectangle with keyboard' }).click();
  await page.getByRole('spinbutton', { name: 'Redaction 1 left in percent' }).fill('5');
  await page.getByRole('spinbutton', { name: 'Redaction 1 top in percent' }).fill('32');
  await page.getByRole('spinbutton', { name: 'Redaction 1 width in percent' }).fill('90');
  await page.getByRole('spinbutton', { name: 'Redaction 1 height in percent' }).fill('10');
  await page.getByRole('link', { name: 'Export document' }).click();
  await expect(page.getByRole('button', { name: 'Download document', exact: true })).toBeDisabled();
  await page.getByLabel('Document language').selectOption('eng+fra');
  await page.getByRole('button', { name: 'Recognize text', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel recognition', exact: true }).click();
  await expect(page.getByText('Recognition cancelled.', { exact: false })).toBeVisible();
  await recognize(page);
  const words = page.getByRole('textbox', { name: /^Word \d+ on sheet 1$/ });
  const recognized = await words.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value).join(' '));
  expect(recognized).toMatch(/HELLO VAULTSCAN/i);
  expect(recognized).not.toMatch(/SECRET|TOKEN/i);
  await page.getByLabel('Sheet to review').selectOption('1');
  const secondWords = await page.getByRole('textbox', { name: /^Word \d+ on sheet 2$/ }).evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value).join(' '));
  expect(secondWords).toMatch(/SECOND PAGE/i);
  expect(secondWords).not.toMatch(/SECRET|TOKEN/i);
  await page.getByLabel('Sheet to review').selectOption('0');
  await page.getByRole('textbox', { name: 'Word 1 on sheet 1', exact: true }).fill('CORRECTED');
  await page.getByRole('checkbox', { name: /I have reviewed the text on all 2 sheets/ }).check();
  // Renaming preserves reviewed OCR, whereas a DPI change must invalidate it.
  await page.getByRole('textbox', { name: 'Filename', exact: true }).fill('searchable-reviewed.pdf');
  await expect(page.getByRole('button', { name: 'Download document', exact: true })).toBeEnabled();
  const searchableDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download document', exact: true }).click();
  const searchable = await downloadBytes(await searchableDownload, 'searchable');
  const extracted = await extractText(searchable);
  expect(extracted[0]).toContain('CORRECTED');
  expect(extracted.join(' ')).not.toMatch(/SECRET|TOKEN|PRIVATE SOURCE AUTHOR/);
  const pdf = await PDFDocument.load(searchable, { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getAuthor()).toBe(''); expect(pdf.getCreator()).toBe(''); expect(pdf.getProducer()).toBe('');
  expect(pdf.getCreationDate()).toBeUndefined();
  await page.getByRole('button', { name: /^300\s*DPI$/ }).click();
  await expect(page.getByRole('heading', { name: 'Review recognized text' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download document', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^200\s*DPI$/ }).click();
  await page.getByRole('button', { name: /^Clean text PDF/ }).click();
  await recognize(page);
  const text = page.getByRole('textbox', { name: 'Recognized text — sheet 1', exact: true });
  await expect(text).toHaveValue(/HELLO VAULTSCAN/i);
  expect(await text.inputValue()).not.toMatch(/SECRET|TOKEN/i);
  await text.fill('Café français — corrected, clear digital letters.');
  await page.getByRole('checkbox', { name: /I have reviewed the text on all 2 sheets/ }).check();
  const cleanDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download document', exact: true }).click();
  const clean = await downloadBytes(await cleanDownload, 'clean');
  expect((await extractText(clean))[0]).toBe('Café français — corrected, clear digital letters.');
  const cleanPdf = await PDFDocument.load(clean);
  expect(cleanPdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')).toHaveLength(0);
  await page.screenshot({ path: '.qa/playwright/ocr-clean-text-desktop.png', fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })) ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.qa/playwright/ocr-clean-text-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(failures).toEqual([]);
  expect(await page.evaluate(() => (window as Window & { ocrCspViolations?: string[] }).ocrCspViolations)).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((request) => new URL(request.url).origin !== origin || !['GET', 'HEAD'].includes(request.method) || request.body)).toEqual([]);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('invalid PDF reports an actionable error without adding partial pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Close introduction' }).click();
  await page.getByLabel('Import document images').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\ninvalid') });
  await expect(page.getByText('This PDF is damaged or unsupported.', { exact: false })).toBeVisible();
  await expect(page.getByText('No pages were added.', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
