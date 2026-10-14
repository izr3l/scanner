import { expect, test, type Page, type Download } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";

const BASE = "http://localhost:3000";

async function syntheticDocument() {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100"><rect width="900" height="1100" fill="#30343c"/><polygon points="195,82 743,137 787,978 130,1010" fill="#f9f7f2" stroke="#17191d" stroke-width="5"/><circle cx="294" cy="225" r="35" fill="#273344"/><rect x="357" y="201" width="302" height="18" fill="#273344"/><rect x="357" y="235" width="228" height="12" fill="#595d66"/><path d="M238 356H691M232 388H675M226 420H682M220 452H650M214 484H676M208 516H660M202 548H670M196 580H638M190 612H660M184 644H635M178 676H644M172 708H620M166 740H630M160 772H598M154 804H620" stroke="#595d66" stroke-width="8"/><rect x="273" y="570" width="270" height="100" fill="#325a91"/><path d="M249 904H611M249 925H453" stroke="#595d66" stroke-width="10"/></svg>`)).png().toBuffer();
}

async function closeIntroduction(page: Page) {
  const button = page.getByRole("button", { name: "Close introduction" });
  await button.waitFor({ state: "visible" });
  await button.click();
  await expect(button).toHaveCount(0);
}

async function importDocument(page: Page) {
  await page.getByLabel("Import document images").setInputFiles({ name: "synthetic-document.png", mimeType: "image/png", buffer: await syntheticDocument() });
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.getByRole("button", { name: /Top left crop corner/ })).toBeVisible();
}

async function assertAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true });
}

async function downloadedBytes(download: Download, prefix: string) {
  const path = `.qa/playwright/${prefix}-${download.suggestedFilename()}`;
  await download.saveAs(path);
  return readFile(path);
}

async function assertRasterPdf(bytes: Uint8Array, expectedPages: number) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(expectedPages);
  expect(pdf.getAuthor() ?? "").toBe("");
  expect(pdf.getCreator() ?? "").toBe("");
  expect(pdf.getProducer() ?? "").toBe("");
  expect(pdf.catalog.has(PDFName.of("Names"))).toBe(false);
  expect(pdf.getForm().getFields()).toHaveLength(0);
  for (const page of pdf.getPages()) {
    expect(page.node.Annots()?.size() ?? 0).toBe(0);
    const resources = page.node.Resources()!;
    const images = resources.lookup(PDFName.of("XObject"), PDFDict);
    expect(images.keys()).toHaveLength(1);
    const image = images.lookup(images.keys()[0]);
    if (!(image instanceof PDFRawStream)) throw new Error("Expected a flattened raster image stream.");
    expect(image.dict.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe("/Image");
    const width = image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    const colors = image.dict.lookup(PDFName.of("ColorSpace"), PDFName).asString();
    expect(colors).toBe("/DeviceRGB");
    const pixels = inflateSync(image.getContents());
    expect(pixels.length).toBe(width * height * 3);
    // A pixel in the middle of the drawn redaction must be irreversibly black in the embedded raster.
    const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
    expect(Array.from(pixels.subarray(center, center + 3))).toEqual([0, 0, 0]);
  }
}

async function monitorPrivacy(page: Page) {
  const failures: string[] = [];
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`${message.text()} (${message.location().url})`); });
  page.on("response", (response) => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
  page.on("request", (request) => { if (/^https?:/.test(request.url())) requests.push({ url: request.url(), method: request.method(), body: request.postData() }); });
  await page.addInitScript(() => {
    const target = window as Window & { testCspViolations?: string[] };
    target.testCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => target.testCspViolations!.push(`${event.violatedDirective}: ${event.blockedURI}`));
  });
  return async () => {
    expect(failures).toEqual([]);
    expect(requests.filter((request) => new URL(request.url).origin !== BASE)).toEqual([]);
    expect(requests.filter((request) => !["GET", "HEAD"].includes(request.method) || request.body)).toEqual([]);
    expect(requests.filter((request) => request.url.includes("synthetic-document"))).toEqual([]);
    expect(await page.evaluate(() => (window as Window & { testCspViolations?: string[] }).testCspViolations)).toEqual([]);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    const cachedUrls = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      return urls;
    });
    expect(cachedUrls.filter((url) => !url.startsWith("http://localhost:3000/") || url.includes("synthetic-document") || url.includes("blob:"))).toEqual([]);
  };
}

test("synthetic scan edits, security rasterization and every export format", async ({ page }) => {
  const assertPrivacy = await monitorPrivacy(page);
  await page.goto("/");
  await closeIntroduction(page);
  await assertAccessible(page);
  await capture(page, ".qa/playwright/home-desktop.png");
  await importDocument(page);
  const corner = page.getByRole("button", { name: /Top left crop corner/ });
  const bounds = await corner.boundingBox();
  if (!bounds) throw new Error("Crop handle must have a visible hit target.");
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 8, { steps: 3 });
  const draggedBounds = await corner.boundingBox();
  expect.soft(Math.abs(draggedBounds!.x + draggedBounds!.width / 2 - (startX + 12))).toBeLessThan(2);
  expect.soft(Math.abs(draggedBounds!.y + draggedBounds!.height / 2 - (startY + 8))).toBeLessThan(2);
  await page.mouse.up();
  const before = await corner.getAttribute("style");
  await corner.focus();
  await page.keyboard.press("ArrowRight");
  expect(await corner.getAttribute("style")).not.toBe(before);
  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(page.getByAltText("Enhanced document preview")).toBeVisible();
  await page.getByRole("button", { name: "Color boost", exact: true }).click();
  const brightness = page.getByRole("slider", { name: "Brightness", exact: true });
  await brightness.focus();
  await page.keyboard.press("ArrowRight");
  await expect(brightness).toHaveValue("1");
  const compare = page.getByRole("button", { name: "Hold to compare" });
  await expect(compare).toBeEnabled();
  await compare.focus();
  await page.keyboard.down("Space");
  await expect(page.getByAltText("Cropped document before enhancement")).toBeVisible();
  await page.keyboard.up("Space");
  await expect(page.getByAltText("Enhanced document preview")).toBeVisible();
  await page.getByRole("button", { name: /\bProtect$/ }).click();
  await page.getByRole("button", { name: "Add rectangle with keyboard" }).click();
  await page.getByRole("spinbutton", { name: "Redaction 1 left in percent" }).fill("25");
  await page.getByRole("spinbutton", { name: "Redaction 1 top in percent" }).fill("40");
  await page.getByRole("spinbutton", { name: "Redaction 1 width in percent" }).fill("50");
  await page.getByRole("spinbutton", { name: "Redaction 1 height in percent" }).fill("15");
  await assertAccessible(page);
  await capture(page, ".qa/playwright/editor-desktop.png");
  await page.getByRole("button", { name: "Duplicate selected page" }).click();
  await page.getByRole("button", { name: "Move selected page earlier" }).click();
  await page.getByRole("button", { name: /\bArrange$/ }).click();
  await expect(page.getByAltText("First arranged sheet preview")).toBeVisible();
  await page.getByLabel("Paper size").selectOption("a4");
  await page.getByRole("link", { name: "Export document" }).click();
  await expect(page).toHaveURL(/\/export\/?$/);
  await expect(page.getByAltText("First export sheet with the chosen layout, watermark and redactions")).toBeVisible();
  await assertAccessible(page);
  await capture(page, ".qa/playwright/export-desktop.png");
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download document", exact: true }).click();
  await assertRasterPdf(await downloadedBytes(await pdfDownload, "multi-page"), 2);
  // Remove the duplicate so each raster format also exercises single-file delivery.
  await page.getByRole("link", { name: "Back to editing" }).click();
  await page.getByRole("button", { name: "Delete selected page" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit page 2" })).toHaveCount(0);
  await page.getByRole("link", { name: "Export document" }).click();
  for (const format of ["PNG", "JPEG", "WebP"] as const) {
    await page.getByRole("button", { name: new RegExp(`^${format}`) }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download document", exact: true }).click();
    const bytes = await downloadedBytes(await download, format.toLowerCase());
    expect(bytes.includes(Buffer.from("Exif\0\0"))).toBe(false);
    const metadata = await sharp(bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBeGreaterThan(1000);
    expect(metadata.height).toBeGreaterThan(1000);
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const offset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(Math.max(...data.subarray(offset, offset + 3))).toBeLessThan(12);
  }
  await assertPrivacy();
  await page.reload();
  await closeIntroduction(page);
  await expect(page.getByRole("heading", { name: "Something worth sharing." })).toBeVisible();
  await assertPrivacy();
});

test("offline scanning and export after the service worker finishes caching", async ({ page, context }) => {
  const assertPrivacy = await monitorPrivacy(page);
  await page.goto("/");
  await closeIntroduction(page);
  await expect(page.getByText("Offline-ready", { exact: false }).first()).toBeVisible({ timeout: 90_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await closeIntroduction(page);
  await expect(page.getByRole("heading", { name: "Start with a scan" })).toBeVisible();
  await importDocument(page);
  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(page.getByAltText("Enhanced document preview")).toBeVisible();
  await page.getByRole("link", { name: "Export document" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download document", exact: true }).click();
  const pdf = await PDFDocument.load(await downloadedBytes(await download, "offline"));
  expect(pdf.getPageCount()).toBe(1);
  await assertPrivacy();
});

test("mobile layout, keyboard controls and accessibility on home, editor and settings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assertPrivacy = await monitorPrivacy(page);
  await page.goto("/");
  await closeIntroduction(page);
  await assertAccessible(page);
  await capture(page, ".qa/playwright/home-mobile.png");
  await importDocument(page);
  await assertAccessible(page);
  await capture(page, ".qa/playwright/editor-mobile.png");
  await page.getByRole("button", { name: "Crop", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Crop your scan" })).toBeVisible();
  await page.getByRole("button", { name: "Apply crop" }).click();
  await page.getByRole("button", { name: "Close tools" }).click();
  await expect(page.getByAltText("Enhanced document preview")).toBeVisible();
  await page.getByRole("link", { name: "Export", exact: true }).click();
  await expect(page.getByAltText("First export sheet with the chosen layout, watermark and redactions")).toBeVisible();
  await assertAccessible(page);
  await capture(page, ".qa/playwright/export-mobile.png");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy & settings" })).toBeVisible();
  const light = page.getByRole("button", { name: "Light", exact: true });
  await light.focus();
  await page.keyboard.press("Enter");
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await assertAccessible(page);
  await capture(page, ".qa/playwright/settings-mobile-light.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await assertPrivacy();
});

test("fresh mobile workspace and both privacy themes are accessible without a scan", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assertPrivacy = await monitorPrivacy(page);
  await page.goto("/");
  await closeIntroduction(page);
  await assertAccessible(page);
  await capture(page, ".qa/playwright/home-mobile.png");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy & settings" })).toBeVisible();
  await assertAccessible(page);
  await page.getByRole("button", { name: "Light", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertAccessible(page);
  await capture(page, ".qa/playwright/settings-mobile-light.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await assertPrivacy();
});

test("synthetic live camera captures, stacks pages and releases tracks on exit or simulated background", async ({ page }) => {
  const assertPrivacy = await monitorPrivacy(page);
  await page.addInitScript(() => {
    const target = window as Window & { testCameraStreams?: MediaStream[] };
    target.testCameraStreams = [];
    const media = navigator.mediaDevices;
    const nativeGetUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await nativeGetUserMedia(constraints);
      target.testCameraStreams!.push(stream);
      return stream;
    };
  });
  await page.goto("/scan/");
  await closeIntroduction(page);
  const autoCapture = page.getByRole("button", { name: "Auto-capture", exact: true });
  if (await autoCapture.getAttribute("aria-pressed") === "true") await autoCapture.click();
  const shutter = page.getByRole("button", { name: "Capture document", exact: true });
  await expect(shutter).toBeEnabled({ timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { testCameraStreams?: MediaStream[] };
    return target.testCameraStreams!.at(-1)?.getVideoTracks()[0]?.readyState;
  })).toBe("live");
  await capture(page, ".qa/playwright/camera-desktop.png");
  await shutter.click();
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.getByRole("button", { name: /Top left crop corner/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { testCameraStreams?: MediaStream[] };
    return target.testCameraStreams!.flatMap((stream) => stream.getTracks()).every((track) => track.readyState === "ended");
  })).toBe(true);
  await page.getByRole("link", { name: /^New scan/ }).click();
  await expect(shutter).toBeEnabled();
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await shutter.click();
  await expect(page).toHaveURL(/\/scan\/?$/);
  await expect(page.getByRole("button", { name: /Review 2 pages/ })).toBeVisible();
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await expect(page.getByRole("button", { name: /Review 3 pages/ })).toBeVisible();
  // Headless Chromium keeps all tabs visible. Exercise the real listener with a controlled visibility boundary.
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { testCameraStreams?: MediaStream[] };
    return target.testCameraStreams!.flatMap((stream) => stream.getTracks()).every((track) => track.readyState === "ended");
  })).toBe(true);
  await page.evaluate(() => { Reflect.deleteProperty(document, "hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("heading", { name: "Camera paused", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume camera", exact: true }).click();
  await expect(shutter).toBeEnabled();
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { testCameraStreams?: MediaStream[] };
    return target.testCameraStreams!.at(-1)?.getVideoTracks()[0]?.readyState;
  })).toBe("live");
  await assertAccessible(page);
  await assertPrivacy();
});
