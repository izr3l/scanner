import { expect, test, type Page, type Download, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFPage } from "pdf-lib";
import type { CV } from "../../lib/cv/runtime";

const BASE = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").origin;

async function syntheticDocument() {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100"><rect width="900" height="1100" fill="#30343c"/><polygon points="195,82 743,137 787,978 130,1010" fill="#f9f7f2" stroke="#17191d" stroke-width="5"/><circle cx="294" cy="225" r="35" fill="#273344"/><rect x="357" y="201" width="302" height="18" fill="#273344"/><rect x="357" y="235" width="228" height="12" fill="#595d66"/><path d="M238 356H691M232 388H675M226 420H682M220 452H650M214 484H676M208 516H660M202 548H670M196 580H638M190 612H660M184 644H635M178 676H644M172 708H620M166 740H630M160 772H598M154 804H620" stroke="#595d66" stroke-width="8"/><rect x="273" y="570" width="270" height="100" fill="#325a91"/><path d="M249 904H611M249 925H453" stroke="#595d66" stroke-width="10"/></svg>`)).png().toBuffer();
}

async function perspectiveA4Document() {
  const width = 840, height = 1188;
  const vertical = Array.from({ length: 7 }, (_, i) => `<path d="M${120 + i * 100} 210V1010"/>`).join("");
  const horizontal = Array.from({ length: 9 }, (_, i) => `<path d="M120 ${210 + i * 100}H720"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g stroke="#b0b0b0" stroke-width="2">${vertical}${horizontal}</g><path d="M420 100L390 150H410V185H430V150H450Z" fill="#222"/><circle cx="420" cy="594" r="80" fill="#00b8c8"/><rect x="18" y="18" width="28" height="28" fill="#e53935"/><rect x="794" y="18" width="28" height="28" fill="#04b444"/><rect x="794" y="1142" width="28" height="28" fill="#2456e8"/><rect x="18" y="1142" width="28" height="28" fill="#c520c7"/></svg>`;
  const raw = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
  // Fixture generation runs only in Node; the browser still imports, detects and renders a real photo.
  const requireCV = createRequire(resolve("package.json"));
  const cv = await (requireCV("@techstark/opencv-js") as CV | Promise<CV>);
  const source = cv.matFromImageData({ data: new Uint8ClampedArray(raw), width, height, colorSpace: "srgb" } as ImageData);
  const corners = [{ x: 270, y: 80 }, { x: 1030, y: 240 }, { x: 930, y: 1270 }, { x: 120, y: 1430 }];
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(({ x, y }) => [x, y]));
  const transform = cv.getPerspectiveTransform(from, to), photo = new cv.Mat();
  try {
    cv.warpPerspective(source, photo, transform, new cv.Size(1300, 1600), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(32, 36, 43, 255));
    const buffer = await sharp(Buffer.from(photo.data), { raw: { width: 1300, height: 1600, channels: 4 } }).png().toBuffer();
    return { buffer, corners, width: 1300, height: 1600 };
  } finally { for (const mat of [source, from, to, transform, photo]) mat.delete(); }
}

function pdfRaster(page: PDFPage) {
  const images = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
  expect(images.keys()).toHaveLength(1);
  const image = images.lookup(images.keys()[0]);
  if (!(image instanceof PDFRawStream)) throw new Error("Expected a flattened raster image stream.");
  expect(image.dict.lookup(PDFName.of("Subtype"), PDFName).asString()).toBe("/Image");
  expect(image.dict.lookup(PDFName.of("ColorSpace"), PDFName).asString()).toBe("/DeviceRGB");
  const width = image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
  const height = image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
  const data = inflateSync(image.getContents());
  expect(data.length).toBe(width * height * 3);
  return { width, height, data };
}

function assertFullA4Raster({ width, height, data }: ReturnType<typeof pdfRaster>) {
  type Color = "red" | "green" | "blue" | "magenta" | "cyan";
  const boxes = Object.fromEntries((["red", "green", "blue", "magenta", "cyan"] as Color[]).map((color) => [color, { left: width, top: height, right: -1, bottom: -1, count: 0 }])) as Record<Color, { left: number; top: number; right: number; bottom: number; count: number }>;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    const color: Color | null = r > 180 && g < 100 && b < 120 ? "red"
      : g > 120 && r < 100 && b < 120 ? "green"
        : b > 180 && r < 100 && g < 140 ? "blue"
          : r > 140 && b > 140 && g < 110 ? "magenta"
            : r < 90 && g > 130 && b > 140 ? "cyan" : null;
    if (!color) continue;
    const box = boxes[color];
    box.left = Math.min(box.left, x); box.top = Math.min(box.top, y);
    box.right = Math.max(box.right, x); box.bottom = Math.max(box.bottom, y); box.count++;
  }
  for (const color of ["red", "green", "blue", "magenta"] as const) expect(boxes[color].count).toBeGreaterThan(400);
  // The four markers retain their orientation and reach near every sheet edge: no added white border.
  expect(boxes.red.right).toBeLessThan(width * 0.08); expect(boxes.red.bottom).toBeLessThan(height * 0.08);
  expect(boxes.green.left).toBeGreaterThan(width * 0.92); expect(boxes.green.bottom).toBeLessThan(height * 0.08);
  expect(boxes.blue.left).toBeGreaterThan(width * 0.92); expect(boxes.blue.top).toBeGreaterThan(height * 0.92);
  expect(boxes.magenta.right).toBeLessThan(width * 0.08); expect(boxes.magenta.top).toBeGreaterThan(height * 0.92);
  expect(boxes.cyan.count).toBeGreaterThan(5000);
  const circleRatio = (boxes.cyan.right - boxes.cyan.left + 1) / (boxes.cyan.bottom - boxes.cyan.top + 1);
  expect(Math.abs(circleRatio - 1)).toBeLessThan(0.05);
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
    expect(cachedUrls.filter((url) => !url.startsWith(`${BASE}/`) || url.includes("synthetic-document") || url.includes("blob:"))).toEqual([]);
  };
}

async function readyManualCamera(page: Page) {
  const autoCapture = page.getByRole("button", { name: "Auto-capture", exact: true });
  await expect(autoCapture).toBeVisible();
  if (await autoCapture.getAttribute("aria-pressed") === "true") await autoCapture.click();
  const shutter = page.getByRole("button", { name: "Capture document", exact: true });
  await expect(shutter).toBeEnabled({ timeout: 90_000 });
  return shutter;
}

async function assertInsideViewport(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(async () => locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
  })).toBe(true);
}

async function assertPlacementGuide(page: Page, label: RegExp, expectedRatio: number) {
  await expect(page.getByRole("img", { name: label })).toBeVisible();
  await expect.poll(async () => page.locator(".camera-placement-guide").evaluate((element, ratio) => {
    const outline = element.querySelector(".placement-outline");
    const video = document.querySelector<HTMLVideoElement>(".camera-view video");
    if (!outline || !video?.videoWidth || !video.videoHeight) return false;
    const frame = outline.getBoundingClientRect();
    const bounds = video.getBoundingClientRect();
    const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
    const contentWidth = video.videoWidth * scale;
    const contentHeight = video.videoHeight * scale;
    const left = bounds.left + (bounds.width - contentWidth) / 2;
    const top = bounds.top + (bounds.height - contentHeight) / 2;
    return frame.width > 20 && frame.height > 20 && Math.abs(frame.width / frame.height / ratio - 1) < 0.005
      && frame.left >= left - 1 && frame.right <= left + contentWidth + 1
      && frame.top >= top - 1 && frame.bottom <= top + contentHeight + 1;
  }, expectedRatio)).toBe(true);
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

test("camera placement outlines fit the video and captured-page review stays reachable at compact sizes", async ({ page }) => {
  const assertPrivacy = await monitorPrivacy(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/scan/?mode=batch");
  await closeIntroduction(page);
  const shutter = await readyManualCamera(page);
  await expect(page.getByRole("button", { name: "Batch", exact: true })).toHaveAttribute("aria-pressed", "true");
  await shutter.click();
  const review = page.getByRole("button", { name: "Review 1 page", exact: true });
  await expect(review).toBeEnabled();
  const promptHandled = await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, { prompt: { value: async () => undefined }, userChoice: { value: Promise.resolve({ outcome: "dismissed" }) } });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(promptHandled).toBe(true);
  await expect(page.locator(".install-pill")).toHaveCount(0);
  const modes = [
    { name: "Document", label: /^Document placement guide$/, ratio: 210 / 297 },
    { name: "ID card", label: /^Front of ID card .* placement guide$/, ratio: 85.6 / 53.98 },
    { name: "Passport", label: /^Passport .* placement guide$/, ratio: 125 / 88 },
    { name: "Book", label: /^Book page placement guide$/, ratio: 210 / 297 },
    { name: "Batch", label: /^Batch .* placement guide$/, ratio: 210 / 297 },
  ];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 667 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0, 0));
    for (const mode of modes) {
      await page.getByRole("button", { name: mode.name, exact: true }).click();
      await assertPlacementGuide(page, mode.label, mode.ratio);
      if (mode.name === "ID card" && viewport.width === 390 && viewport.height === 667) {
        await page.screenshot({ path: ".qa/playwright/camera-id-390x667.png" });
      }
    }
    await page.evaluate(() => scrollTo(0, 0));
    await assertInsideViewport(shutter);
    await assertInsideViewport(review);
    await assertInsideViewport(page.getByRole("button", { name: "Import images from device", exact: true }));
    await expect(page.locator(".install-pill")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.qa/playwright/camera-batch-${viewport.width}x${viewport.height}.png` });
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import images from device", exact: true }).click();
  const gallery = await chooser;
  expect(gallery.isMultiple()).toBe(true);
  await gallery.setFiles([]);
  // Delay only this real capture's encoding callback so navigation controls are checked before commit.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) {
      HTMLCanvasElement.prototype.toBlob = original;
      original.call(this, (blob) => { setTimeout(() => callback(blob), 800); }, type, quality);
    };
  });
  await shutter.click();
  await expect(page.getByRole("button", { name: "Import images from device", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Switch camera", exact: true })).toBeDisabled();
  await expect(review).toBeDisabled();
  await expect(page.locator(".capture-tray-thumbnails")).toHaveJSProperty("inert", true);
  for (const mode of modes) await expect(page.getByRole("button", { name: mode.name, exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review 2 pages", exact: true })).toBeEnabled();
  await expect(page.locator(".capture-tray-thumbnails")).toHaveJSProperty("inert", false);
  // Compact trays show the newest thumbnail; desktop exposes the earlier page's direct shortcut.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Review captured page 1", exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.getByRole("button", { name: "Edit page 1", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".editor-preview-type")).toContainText("Batch");
  await assertPrivacy();
});

test("ID front and back prompts ignore unrelated document pages and batch thumbnails select the right scan", async ({ page }) => {
  const assertPrivacy = await monitorPrivacy(page);
  await page.goto("/scan/");
  await closeIntroduction(page);
  const shutter = await readyManualCamera(page);
  await shutter.click();
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.locator(".editor-preview-type")).toContainText("Document");
  await page.getByRole("link", { name: /^New scan/ }).click();
  await readyManualCamera(page);
  await page.getByRole("button", { name: "ID card", exact: true }).click();
  await assertPlacementGuide(page, /^Front of ID card .* placement guide$/, 85.6 / 53.98);
  await shutter.click();
  await expect(page).toHaveURL(/\/scan\/?$/);
  await expect(page.getByRole("button", { name: "Review 2 pages", exact: true })).toBeEnabled();
  await assertPlacementGuide(page, /^Back of ID card .* placement guide$/, 85.6 / 53.98);
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await assertPlacementGuide(page, /^Document placement guide$/, 210 / 297);
  await page.getByRole("button", { name: "ID card", exact: true }).click();
  await assertPlacementGuide(page, /^Back of ID card .* placement guide$/, 85.6 / 53.98);
  await shutter.click();
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.getByRole("button", { name: "Edit page 3", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".editor-preview-type")).toContainText("ID card");
  await page.getByRole("link", { name: /^New scan/ }).click();
  await readyManualCamera(page);
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  await shutter.click();
  await expect(page.getByRole("button", { name: "Review 4 pages", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Review captured page 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review captured page 2", exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(page.getByRole("button", { name: "Edit page 2", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Edit page 4", exact: true })).toBeVisible();
  await assertPrivacy();
});

test("declared A4 paper restores an angled scan and exports a full sheet with readable filenames", async ({ page }) => {
  const assertPrivacy = await monitorPrivacy(page);
  const fixture = await perspectiveA4Document();
  await page.goto("/");
  await closeIntroduction(page);
  const date = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  await page.getByLabel("Import document images").setInputFiles({ name: "synthetic-document-a4.png", mimeType: "image/png", buffer: fixture.buffer });
  await expect(page).toHaveURL(/\/edit\/?$/);
  for (const [index, label] of ["Top left", "Top right", "Bottom right", "Bottom left"].entries()) {
    const position = await page.getByRole("button", { name: new RegExp(`^${label} crop corner`) }).evaluate((element) => ({ x: parseFloat((element as HTMLElement).style.left), y: parseFloat((element as HTMLElement).style.top) }));
    expect(Math.hypot(position.x / 100 * fixture.width - fixture.corners[index].x, position.y / 100 * fixture.height - fixture.corners[index].y)).toBeLessThan(20);
  }
  const sourcePaper = page.getByRole("combobox", { name: "Scanned paper size", exact: true });
  await expect(sourcePaper).toHaveValue("original");
  await sourcePaper.selectOption("a4");
  await page.getByRole("button", { name: "Apply crop", exact: true }).click();
  const rendered = page.getByAltText("Enhanced document preview", { exact: true });
  await expect(rendered).toBeVisible();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect.poll(() => rendered.evaluate((element) => {
    const image = element as HTMLImageElement;
    return Math.abs(image.naturalWidth / image.naturalHeight / (210 / 297) - 1);
  })).toBeLessThan(0.01);
  await page.getByRole("link", { name: "Export document", exact: true }).click();
  const filename = page.getByRole("textbox", { name: "Filename", exact: true });
  await expect(filename).toHaveValue(`document-${date}.pdf`);
  await expect(page.getByText(/\{(?:type|date)\}/)).toHaveCount(0);
  await page.getByRole("button", { name: /Adjust page layout/ }).click();
  await expect(page.getByRole("button", { name: "Auto-select page orientation", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Margin", exact: true })).toHaveValue("0");
  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download document", exact: true }).click();
  const portraitDownload = await firstDownload;
  expect(portraitDownload.suggestedFilename()).toBe(`document-${date}.pdf`);
  const portrait = await PDFDocument.load(await downloadedBytes(portraitDownload, "corrected-a4"), { updateMetadata: false });
  const portraitSize = portrait.getPage(0).getSize();
  expect(portraitSize.width / 72 * 25.4).toBeCloseTo(210, 3);
  expect(portraitSize.height / 72 * 25.4).toBeCloseTo(297, 3);
  const raster = pdfRaster(portrait.getPage(0));
  assertFullA4Raster(raster);
  await sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 3 } }).png().toFile(".qa/playwright/corrected-a4-raster.png");
  await capture(page, ".qa/playwright/export-a4-corrected.png");
  await page.getByRole("button", { name: /^JPEG/ }).click();
  await expect(filename).toHaveValue(`document-${date}.jpg`);
  await filename.fill("Personal copy.pdf");
  await filename.press("Tab");
  await expect(filename).toHaveValue("Personal copy.jpg");
  const customDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download document", exact: true }).click();
  const jpegDownload = await customDownload;
  expect(jpegDownload.suggestedFilename()).toBe("Personal copy.jpg");
  expect((await sharp(await downloadedBytes(jpegDownload, "custom-name")).metadata()).format).toBe("jpeg");
  await page.getByRole("link", { name: "Back to editing", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Scanned paper size", exact: true })).toHaveValue("a4");
  await page.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(rendered).toBeVisible();
  await page.getByRole("button", { name: "Rotate 90 degrees clockwise", exact: true }).click();
  await expect.poll(() => rendered.evaluate((element) => (element as HTMLImageElement).naturalWidth > (element as HTMLImageElement).naturalHeight)).toBe(true);
  await page.getByRole("link", { name: "Export document", exact: true }).click();
  const landscapeDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download document", exact: true }).click();
  const landscape = await PDFDocument.load(await downloadedBytes(await landscapeDownloadEvent, "auto-landscape-a4"), { updateMetadata: false });
  const landscapeSize = landscape.getPage(0).getSize();
  expect(landscapeSize.width / 72 * 25.4).toBeCloseTo(297, 3);
  expect(landscapeSize.height / 72 * 25.4).toBeCloseTo(210, 3);
  await page.getByRole("button", { name: /Adjust page layout/ }).click();
  await page.getByRole("button", { name: "Portrait", exact: true }).click();
  await page.getByRole("link", { name: "Back to editing", exact: true }).click();
  await page.getByRole("button", { name: /\bEnhance$/ }).click();
  await page.getByRole("slider", { name: "Brightness", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("link", { name: "Export document", exact: true }).click();
  await page.getByRole("button", { name: /Adjust page layout/ }).click();
  await expect(page.getByRole("button", { name: "Portrait", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Auto-select page orientation", exact: true })).toHaveAttribute("aria-pressed", "false");
  const manualDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download document", exact: true }).click();
  const manual = await PDFDocument.load(await downloadedBytes(await manualDownloadEvent, "manual-portrait-a4"), { updateMetadata: false });
  expect(manual.getPage(0).getSize().height).toBeGreaterThan(manual.getPage(0).getSize().width);
  await assertPrivacy();
});
