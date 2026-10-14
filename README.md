# Vaultscan

A document-scanning PWA. Capture or import a photo, adjust its corners, flatten and enhance it, arrange pages, and export PDF, PNG, JPEG, or WebP. Processing happens on the device, with no accounts, scan uploads, analytics, or remote fonts.

## Scope

There is no saved library, IndexedDB, scan encryption at rest, passcode, lock/unlock, or Vault. Reloading or closing the app discards the session. Export files you want to keep before leaving. Downloads, clipboard contents, and files shared with another app are outside the temporary workspace.

Only public app assets are cached for offline use. The service worker never caches scans. OCR, passport MRZ reading, and searchable PDFs remain v2. Password-protected PDFs are deferred until a vetted encryption library is selected.

## Run locally

Use Node.js 24 and npm. Install the exact dependencies from the lockfile with dependency lifecycle scripts disabled:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://localhost:3000`. Both `dev` and `build` explicitly prepare local fonts, dependency styles, and the scanner worker. Run `npm run prepare` separately when you need those artifacts without starting the app. The development server supports iteration; it is not the security or offline acceptance environment.

For the production static export and strict security headers:

```sh
npm run build
npm run preview
```

Open `http://localhost:3000`. `PORT` can select a different preview port. The preview serves `out/` with the generated CSP and other HTTP headers. Camera and service-worker APIs require a secure context: localhost is suitable for desktop development; testing a phone against a LAN address requires HTTPS.

`npm run start` is an alias for the strict production preview. Build the app first; it serves the generated `out/` directory rather than starting a Next.js server.

Run the available automated gates:

```sh
npm run verify
npm audit --audit-level=high
```

`verify` runs TypeScript, ESLint, unit tests, and the static build. The audit contacts the npm advisory service for dependency information; it does not run in the app or send scans. Tests cover real OpenCV detection and enhancement, crop geometry, asset integrity, import validation, physical export layout, redaction bounds, PDF metadata, and print resolution. CI adds dependency review for pull requests. Review CI results in the repository; configuring a workflow does not demonstrate that a hosted CI run has passed.

Run the production browser checks after building:

```sh
npm run build
npm run test:browser
```

The Playwright harness starts the strict-CSP preview automatically and uses an existing Microsoft Edge installation on Windows. On Linux or CI, first install its Chromium runtime:

```sh
npx playwright install --with-deps chromium
npm run test:browser
```

Browser checks exercise synthetic imports, editing and keyboard controls, redaction rasterization, all export formats, offline reload/export, and accessibility. A synthetic live camera checks manual capture, Book/Batch stacking, track shutdown on exit, and a simulated background visibility event; headless Chromium does not reproduce an OS app switch. Traces, screenshots, synthetic fixtures, and downloaded test exports stay under the ignored `.qa/` directory. The separate `node tests/cv-worker.mjs` check uses an installed Chrome on Windows to verify a 12 MP image through the strict-CSP worker; it is optional and runs after asset preparation. Neither harness establishes real iPhone or Android compatibility.

## Using the scanner

1. Choose Document, ID card, Passport, Book, or Batch. Open the live camera or import JPEG, PNG, or WebP files. A native camera input provides a fallback when live camera access is unavailable.
2. Capture manually, or let auto-capture wait for stable edges and acceptable light, glare, and blur. Book and Batch keep the camera open for another page. Quality hints let you decide whether to retake a shot.
3. Adjust the crop corners, use Auto to re-detect, and inspect the flattened preview. Filters and adjustment controls retain an edit recipe rather than modifying the original.
4. Arrange the session: reorder, duplicate, or delete pages; select a paper preset, orientation, margin, and fit mode. **Auto** orientation uses the selected page's crop and rotation, changing orientation only when pressed. ID copy locks paper to A4 and places the front and back of ID-1 cards at 85.6 × 53.98 mm, with optional crop marks, preserving your chosen orientation. Print the PDF at 100% or “actual size”; printer “fit to page” settings change the physical dimensions.
5. Add opaque redactions and an optional watermark, inspect the export preview, and export. PDFs contain multiple arranged sheets; image exports produce a separate file for each sheet. Browser sharing and image clipboard support vary, so downloading remains available.

Imports are capped at 32 MiB, 40 megapixels, and 16,384 pixels on either edge. Large images are validated before worker decoding, then checked again after decoding. Perspective correction processes padded tiles to limit the WASM working set. An exported raster is capped at 48 megapixels; reduce custom paper size or DPI if it exceeds that cap. The live size estimate is approximate because scan content affects compression.

PNG and JPEG exports include the selected print density without EXIF. WebP has pixel dimensions derived from the selected DPI, with no EXIF added; PDF is the reliable format for physical page dimensions and true-size ID copies.

## Build and asset pipeline

- Next.js App Router uses `output: 'export'`. There are no API routes or server actions. `out/` is the complete deployable site.
- `scripts/prepare-assets.mjs` copies pinned Syne, Inter, and JetBrains Mono fonts from installed packages and bundles `lib/cv/worker.ts` together with the self-hosted OpenCV engine and its embedded WASM into `public/cv/worker.js`.
- `scripts/opencv-csp.mjs` replaces the pinned engine's generated embind `createJsInvoker` and emval `__emval_create_invoker` with closure implementations. Preparation checks the expected binding boundaries and rejects remaining `eval` or `new Function` patterns. An OpenCV upgrade requires reviewing the patch and rerunning CV/browser checks.
- `lib/asset-integrity.ts` records the combined worker's SHA-256 digest. The main thread fetches and verifies the complete artifact before creating a blob worker; its engine and embedded WASM are covered by the same digest. There is no separate runtime OpenCV fetch or `importScripts` step. `public/cv/opencv.js` is only a generated build/test artifact; postbuild removes its copy from `out/`, preventing duplicate download or precaching. No CDN is used at runtime.
- Vaul and Sonner styles are extracted into `app/vendor.css`, and narrow build loaders remove their runtime style-block injection. Extraction fixes the pinned Vaul 1.1.2 stray colon in its handle hit-area rule. A separate adapter replaces `react-remove-scroll-bar` style injection with external CSS and a measured numeric scrollbar-width CSS variable. These adapters preserve `style-src 'self'` and fail if their expected dependency source changes.
- `scripts/postbuild.mjs` hashes the emitted Next.js inline bootstrap scripts, adds a narrow same-origin Trusted Types policy before bootstrap, and emits the security header configuration. It also creates dotted aliases for Next's segment-prefetch files so ordinary static hosts can serve App Router navigation requests. It then builds a Serwist service worker with an explicit static precache and no runtime caching.
- PDF generation is loaded when needed. Final export burns redactions into opaque pixels after enhancement, then draws arrangement and watermark, and embeds only the fresh raster. No original image is embedded in the PDF.
- The first-run explainer uses a native modal dialog; editing tools use Vaul. Sonner and import validation load when first needed. Destructive scan actions use Sonner confirmations. The worker bundler resolves only workspace files and installed packages through an explicit source loader, keeping native compilation from scanning unrelated parent directories.

## Hosting

Build once and publish the matching `out/` files and headers together. The CSP hashes are specific to that build; serving stale headers with new HTML can break startup.

| Host | Configuration |
| --- | --- |
| Cloudflare Pages / Netlify | Build command `npm run build`, publish directory `out`. The generated `out/_headers` supplies the required headers. |
| Vercel | `scripts/postbuild.mjs` generates the root `vercel.json` with build command, output directory, and headers for the static site. |
| Other static host | Publish `out/` and configure the headers recorded in `out/security-headers.json`; a generic file server does not automatically apply them. |

Use HTTPS. Confirm the host preserves CSP, HSTS, Permissions Policy, Referrer Policy, content-type protection, and same-origin resource/opener headers. `npm run preview` provides a local header test; deployment is a separate action and this project setup does not publish anything.

## Airplane-mode acceptance test

Use a production build under `npm run preview` or the intended HTTPS host, not the development server.

1. Load the app online and wait for the real **Offline-ready** status. Allow the initial static precache to finish. Check DevTools Application → Service Workers for the active worker.
2. Open Camera, Editor, Export, and Settings while online. Import one disposable image and complete an export so you know the browser supports the processing path.
3. Close the current temporary session. Disable the network in DevTools, or turn on airplane mode on the device. Keep the app's installed files and browser site data.
4. Reload or reopen the installed PWA. The app shell, local fonts, and scanner engine should load. Import a new image or capture a new document, crop it, change a filter, redact a field, arrange it, and export a PDF and an image.
5. Confirm Network shows no third-party requests and no request body or URL containing image data. Any requests for app assets must be served by the service worker while offline.
6. Inspect Cache Storage. Entries should be build assets only, with no scan names, thumbnails, originals, or export blobs. IndexedDB should have no Vault or draft scan database.
7. Reload once more. The disposable scan session should be empty while the app remains usable offline.

Failures are release blockers for the offline claim. Browser eviction of app assets can require another online load; the app does not request persistent storage for a scan library.

## Manual device checks

The following matrix must be performed on actual devices and recorded before claiming the spec's device acceptance criteria:

| Area | iPhone / Safari installed PWA | Mid-range Android / Chrome | Desktop Chromium / Firefox / Safari |
| --- | --- | --- | --- |
| Camera | Permission allow/deny; rear-camera preference; native-photo fallback; rotate device | Same, plus supported torch and camera switch | Available webcam and unavailable-camera fallback |
| Lifecycle | Background app and verify camera indicator turns off; resume explicitly | Same, including rapidly switching cameras | Navigate away or hide tab; verify every track stops |
| Capture | Stable auto-capture, manual shutter, glare/blur/low-light hints, ID front/back | Same, including Book/Batch loops | Gallery and drag-and-drop imports; unsupported file errors |
| Editor | Drag/nudge corners, loupe, filter adjustments, rotate/flip, Auto orientation, instant hold-to-compare | Same with a 12 MP+ photo | Mouse and keyboard corner control; reorder and duplicate |
| Protect/export | Redaction remains opaque in final files; watermark; metadata inspection; Share and download | Same, including JPEG/WebP quality | PDF multipage, separate image files, clipboard support and fallback |
| PWA | Install via Add to Home Screen; airplane-mode procedure | Install prompt after a successful scan; airplane mode | Active-worker status, offline reload, update flow |
| Accessibility | VoiceOver, focus visibility, reduced motion, safe-area layout | TalkBack, touch targets, reduced motion | Keyboard-only flow, screen reader labels, light/dark contrast |

Also inspect a final PDF with a PDF parser and exported images with a metadata tool: no EXIF/GPS, blank PDF Author/Creator/Producer, and no original or hidden layer behind redaction. Print an ID-copy PDF at 100% and measure both sides against 85.6 × 53.98 mm.

Check signature motions on those devices: crop corners move into the real flattened result, filter previews crossfade briefly, compare remains instant, and export completion draws a checkmark. Enable reduced motion and repeat; state changes must remain clear without moving the document or corners.

## Verification status

Local verification passed TypeScript (including the service worker), ESLint, 39 unit tests, the static production build, and five browser flows in Edge. The browser flows check opaque redaction pixels inside the final PDF and images, blank PDF metadata, all four export formats, full offline import/export after a reload, memory-only session reset, no third-party requests or image-data requests, no CSP violations, accessible controls, and mobile layout. The dependency audit reported zero vulnerabilities for the installed dependency versions.

Initial modern JavaScript measures 152,549 gzip bytes (149.0 KiB), excluding legacy polyfills, lazy processing/editor/export chunks, CSS, HTML, and fonts. Run `node scripts/measure-shell.mjs` after a build to reproduce that measurement; the full app-shell asset total still needs comparison with the spec's broader budget.

A strict-CSP desktop Chrome worker check processed a 12 MP synthetic image at full resolution: Auto rendering took approximately 3.4 seconds, and Document rendering with adjustments, sharpness, rotation, and flip took approximately 8.3 seconds. Those measurements are worker rendering times on a desktop, not capture-to-export timings or proof on the target phones.

Real iPhone and mid-range Android checks, physical print measurement, complete capture-to-export timing, and full app-shell/TTI/live-detection budgets still require measured evidence. Strict-CSP operation and airplane-mode behavior must also be checked on the final deployed host.

Lighthouse numeric scores remain unverified: its browser audit launcher could not run reliably inside this restricted Windows environment. Run Chrome DevTools Lighthouse on the strict preview or HTTPS deployment to check accessibility and best practices against the 95+ target. The installed Lighthouse 13.5 CLI has no separate PWA score category; the offline, service-worker, manifest, and install flows must be checked directly instead.

See [SECURITY.md](SECURITY.md) for the threat model and privacy limits.
