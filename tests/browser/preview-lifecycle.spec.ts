import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { assertObjectUrlsSafe, monitorObjectUrls } from "./object-url-monitor";

declare global {
  interface Window {
    previewLoadGate: { hold: boolean; held: { image: HTMLImageElement; src: string }[] };
  }
}

/** Like bundleLocal, pass source through explicit project-only resolution; emit no files. */
async function bundleHarness() {
  const workspace = resolve(".");
  const require = createRequire(resolve("package.json"));
  const result = await build({
    entryPoints: ["tests/fixtures/preview-harness.tsx"], write: false, bundle: true,
    platform: "browser", format: "iife", target: "es2022", tsconfigRaw: {}, jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "test-workspace-resolver", setup(builder) {
      builder.onResolve({ filter: /.*/ }, async (args) => {
        const base = args.importer ? dirname(args.importer) : workspace;
        const target = args.kind === "entry-point" || args.path.startsWith(".")
          ? resolve(base, args.path) : require.resolve(args.path, { paths: [base] });
        if (!target.startsWith(workspace + sep)) throw new Error("Harness dependencies must stay inside the workspace.");
        for (const file of [target, ...[".tsx", ".ts", ".js", ".mjs", ".cjs"].map((extension) => target + extension), resolve(target, "index.ts"), resolve(target, "index.js")]) {
          try { if ((await stat(file)).isFile()) return { path: file, namespace: "test-source" }; } catch { /* Try the next explicit filename. */ }
        }
        throw new Error(`Cannot resolve harness dependency ${args.path}`);
      });
      builder.onLoad({ filter: /.*/, namespace: "test-source" }, async (args) => ({
        contents: await readFile(args.path, "utf8"),
        loader: extname(args.path) === ".tsx" ? "tsx" : extname(args.path) === ".ts" ? "ts" : "js",
      }));
    } }],
  });
  return result.outputFiles[0].text;
}

test("actual preview layers keep URL ownership through StrictMode, delayed loads and interrupted fades", async ({ page }, testInfo) => {
  const script = await bundleHarness();
  const errors: string[] = [];
  const failedRequests: { url: string; error: string | null }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? null }));
  await monitorObjectUrls(page);
  await page.addInitScript(() => {
    window.previewLoadGate = { hold: false, held: [] };
    document.addEventListener("load", (event) => {
      const image = event.target;
      if (event.isTrusted && window.previewLoadGate.hold && image instanceof HTMLImageElement && image.classList.contains("preview-image-current")) {
        event.stopImmediatePropagation();
        window.previewLoadGate.held.push({ image, src: image.src });
      }
    }, true);
  });
  const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script'";
  await page.route("**/__qa/preview-lifecycle", (route) => route.fulfill({
    contentType: "text/html", headers: { "Content-Security-Policy": csp },
    body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated preview lifecycle</title><link rel="stylesheet" href="/__qa/preview.css"><link rel="icon" href="data:,"></head><body><main id="root"></main><script src="/__qa/preview.js"></script></body></html>',
  }));
  await page.route("**/__qa/preview.js", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__qa/preview.css", (route) => route.fulfill({ contentType: "text/css", body: ".preview-image-stack{position:relative;width:160px;height:220px}.preview-image-stack img{position:absolute;inset:0;width:100%;height:100%}.is-pending .preview-image-current{opacity:0}.is-active .preview-image-previous{opacity:0}" }));
  await page.goto("/__qa/preview-lifecycle");
  const current = page.locator(".preview-image-current");
  await expect.poll(() => page.evaluate(() => window.previewHarness.setups)).toBe(2);
  await expect.poll(() => current.evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 160)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.previewHarness.loads.length)).toBeGreaterThan(0);
  const original = await current.elementHandle();
  const initialUrls = await page.evaluate(() => Object.keys(window.testObjectUrls.created).length);
  await page.evaluate(() => window.previewHarness.relabel("Same pixels, updated description"));
  await expect(current).toHaveAttribute("alt", "Same pixels, updated description");
  expect(await current.evaluate((image, original) => image === original, original)).toBe(true);
  expect(await page.evaluate(() => Object.keys(window.testObjectUrls.created).length)).toBe(initialUrls);

  // Suppress native load delivery, not resource loading: B remains a pending transition deterministically.
  await page.evaluate(() => { window.previewLoadGate.hold = true; window.previewHarness.choose("b"); });
  await expect.poll(() => page.evaluate(() => window.previewLoadGate.held.length)).toBe(1);
  await expect(page.locator(".preview-image-stack")).toHaveClass(/is-pending/);
  expect(await page.locator(".preview-image-previous").evaluate((image, original) => image === original, original)).toBe(true);
  await page.evaluate(() => window.previewHarness.choose("c"));
  await expect.poll(() => page.evaluate(() => window.previewLoadGate.held.length)).toBe(2);
  expect(await page.locator(".preview-image-previous").evaluate((image, original) => image === original, original)).toBe(true);
  await assertObjectUrlsSafe(page);
  await page.evaluate(() => {
    window.previewLoadGate.hold = false;
    window.previewHarness.choose("a", true);
    for (const { image } of window.previewLoadGate.held.splice(0)) image.dispatchEvent(new Event("load"));
  });
  await expect(current).toHaveAttribute("alt", "Synthetic preview a");
  await expect(page.locator(".preview-image-previous")).toHaveCount(0);
  await expect.poll(() => current.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(160);
  expect(await page.evaluate(() => window.previewHarness.loads.filter(({ name }) => name === "b" || name === "c"))).toEqual([]);
  await assertObjectUrlsSafe(page);

  // Release compare instantly, then interrupt a real active fade with unmount.
  await page.evaluate(() => window.previewHarness.choose("b"));
  await expect(current).toHaveAttribute("alt", "Synthetic preview b");
  await expect.poll(() => page.evaluate(() => window.previewHarness.loads.at(-1)?.name)).toBe("b");
  await expect(page.locator(".preview-image-previous")).toHaveCount(0);
  await page.evaluate(() => window.previewHarness.choose("c"));
  await expect(page.locator(".preview-image-previous")).toHaveCount(1);
  await expect(page.locator(".preview-image-stack")).toHaveClass(/is-active/);
  await page.evaluate(() => window.previewHarness.unmount());
  await expect(current).toHaveCount(0);
  await assertObjectUrlsSafe(page, true);
  expect(await page.evaluate(() => window.previewHarness.cleanups)).toBe(2);
  const audit = await page.evaluate(() => ({
    ...window.testObjectUrls,
    attachedSources: Array.from(document.querySelectorAll("img"), (image) => image.getAttribute("src")),
  }));
  // StrictMode deliberately detaches in-flight loads. Only an audited, fully released blob may abort.
  const unexpectedFailures = failedRequests.filter(({ url, error }) => !(error === "net::ERR_ABORTED"
    && url.startsWith("blob:") && audit.created[url]?.revokes === 1 && !audit.attachedSources.includes(url)));
  expect(unexpectedFailures).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach("native-object-url-lifecycle", { body: JSON.stringify({ ...audit, failedRequests }, null, 2), contentType: "application/json" });
});
