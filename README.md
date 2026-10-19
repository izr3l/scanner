# Vaultscan

A document-scanning PWA. Capture a photo or import images and scanned PDFs, flatten and enhance pages, and export PDF, PNG, JPEG, or WebP. On-device English and French OCR can produce a searchable PDF or rebuild reviewed text in a clear digital font. There are no accounts, scan uploads, analytics, or remote fonts.

## Scope

There is no saved library, IndexedDB, scan encryption at rest, passcode, lock/unlock, or Vault. Reloading or closing the app discards the session. Export files you want to keep before leaving. Downloads, clipboard contents, and files shared with another app are outside the temporary workspace.

The privacy introduction appears on first use. Closing or completing it saves one non-sensitive acknowledgement in this browser's local storage so it stays dismissed on later visits. Scans, recognized text, and session settings are not stored. If browser storage is blocked or cleared, the introduction may appear again.

Only public app assets, including the PDF renderer and OCR language models, are cached for offline use. The service worker never caches scans or recognized text; OCR does not use an IndexedDB model cache. Passport MRZ reading and password-protected PDF export remain deferred. Password-protected PDF imports are rejected.

## Run locally

Use Node.js 24 and npm. Install the exact dependencies from the lockfile with dependency lifecycle scripts disabled:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://localhost:3000`. Both `dev` and `build` explicitly prepare local fonts, dependency styles, PDF rendering assets, and scanner/OCR workers and models. Run `npm run prepare` separately when you need those artifacts without starting the app. The development server supports iteration; it is not the security or offline acceptance environment.

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

GitHub CI runs types, lint, unit tests, the static build, and the dependency advisory audit. Browser automation was removed on 2026-10-18. Check browser behavior manually with `npm run preview` after building, or use `npm run preview -- --vercel` to inspect the generated Vercel artifact. Follow the airplane-mode procedure and device matrix below for navigation, camera, editing, export, accessibility, and offline verification.

## Using the scanner

1. Choose Document, ID card, Passport, Book, or Batch. Fit the page inside its placement outline; ID and passport outlines use their physical aspect ratios and remain inside the visible camera image. The displayed millimeters describe the document, not its size on your screen. **Import images or PDF** accepts JPEG, PNG, WebP, and unlocked PDF files. PDF pages retain their full page bounds and start with the Document cleanup filter. A native camera input provides a fallback when live camera access is unavailable.
2. Capture manually, or let auto-capture wait for stable edges and acceptable light, glare, and blur. Book and Batch keep the camera open for another page. The capture tray shows the session's page count and recent thumbnails: select a thumbnail to edit that page, or press **Review** to open the editor with all captured pages. ID mode guides you through the front and back. Quality hints let you decide whether to retake a shot. Export scans to keep them beyond the current session.
3. Adjust the crop corners, use Auto to re-detect, and inspect the flattened preview. For an angled photo of known paper, choose **Scanned paper size → A4**, Letter, or A5 in Crop to restore the physical proportions. Choosing an export paper size only changes the destination sheet. Original proportions remain the default for receipts and other shapes; ID and passport proportions are fixed. Filters and adjustment controls retain an edit recipe rather than modifying the original.
4. Arrange the session: reorder, duplicate, or delete pages; select a paper preset, orientation, margin, and fit mode. New sessions use **Auto** orientation and **0 mm** added margin: each sheet follows the flattened scan and its rotation. **Fit scanned sheet to paper** restores those settings for an existing session. Explicit Portrait/Landscape settings and added margins remain available. Fit centers the entire scan without stretching or cutting it; a different source aspect ratio can leave white space. ID copy locks paper to A4 and places the front and back of ID-1 cards at 85.6 × 53.98 mm, with optional crop marks; Auto uses portrait A4 for that layout. Print the PDF at 100% or “actual size”; printer “fit to page” settings change the physical dimensions.
5. Add opaque redactions and an optional watermark, inspect the export preview, and choose an output. For searchable or clean text PDFs, select English, French, or English + French, press **Recognize text**, correct the results, and confirm that all sheets have been reviewed. Downloads and sharing require this confirmation; changing the scan or layout invalidates recognition, and editing recognized text requires confirmation again. The filename follows the scan's local date and selected extension. PDFs contain multiple pages; image exports produce one file per sheet. Browser sharing and image clipboard support vary.

| PDF output | Result |
| --- | --- |
| Enhanced scan | The edited page image, with redactions and watermark flattened into pixels. |
| Searchable PDF | The enhanced scan plus a reviewed invisible text layer for search, selection, and copying. Visible letters retain the scan's appearance. |
| Clean text PDF | Reviewed text typeset in a digital font, without scanned images. Text reflows and can span a different number of pages. |

OCR runs on the final arranged, redacted pixels before adding a watermark. It does not reuse text from an imported PDF. Check names, numbers, accents, and reading order. Clean text output does not reconstruct tables, columns, graphics, or the original page layout. Handwriting accuracy is not promised, and OCR cannot reliably recover missing or severely blurred detail. Characters missing from the bundled PDF font produce an error so they can be corrected in review.

Each imported file is capped at 32 MiB, and imports must fit within 40 total session pages. Images are capped at 40 megapixels and 16,384 pixels per edge; dimensions are validated before and after decoding. PDF pages are rendered one at a time at approximately 200 DPI, reduced when needed to 12 megapixels and 16,384 pixels per edge. Damaged, unsupported, or password-protected PDFs fail without adding a partial import. Progress and cancellation are available. OCR input is limited to 12 megapixels and a 6,000-pixel edge. Perspective correction uses padded tiles to limit the WASM working set. An exported raster is capped at 48 megapixels; reduce custom paper size or DPI if it exceeds that cap. The live size estimate is approximate.

PNG and JPEG exports include the selected print density without EXIF. WebP has pixel dimensions derived from the selected DPI, with no EXIF added; PDF is the reliable format for physical page dimensions and true-size ID copies.

## Build and asset pipeline

- Next.js App Router uses `output: 'export'`. There are no API routes or server actions. `out/` is the complete deployable site.
- Mobile navigation uses a persistent Liquid Glass inspired dock with five labeled destinations, a moving selection, safe-area clearance, and accessibility fallbacks. Its styling stays in an external stylesheet under strict CSP; the dedicated camera keeps its own capture controls. [Research, browser limits, and implementation decisions](docs/liquid-glass-mobile-dock-research.md).
- `scripts/prepare-assets.mjs` copies pinned Syne, Inter, and JetBrains Mono fonts from installed packages and bundles `lib/cv/worker.ts` together with the self-hosted OpenCV engine and its embedded WASM into `public/cv/worker.js`.
- `scripts/opencv-csp.mjs` replaces the pinned engine's generated embind `createJsInvoker` and emval `__emval_create_invoker` with closure implementations. Preparation checks the expected binding boundaries and rejects remaining `eval` or `new Function` patterns. An OpenCV upgrade requires reviewing the patch, rerunning CV unit tests, and manually checking processing under strict CSP.
- `lib/asset-integrity.ts` records the combined worker's SHA-256 digest. The main thread fetches and verifies the complete artifact before creating a blob worker; its engine and embedded WASM are covered by the same digest. There is no separate runtime OpenCV fetch or `importScripts` step. `public/cv/opencv.js` is only a generated build/test artifact; postbuild removes its copy from `out/`, preventing duplicate download or precaching. No CDN is used at runtime.
- PDF.js 6 renders imported PDFs to new PNG pages using a same-origin module worker, local CMaps, fonts, and WASM. Tesseract's LSTM core and embedded WASM are bundled with its worker; worker and English/French model bytes are verified before use. Models and the PDF output font come from pinned installed packages and are included in the static precache. Tesseract's IndexedDB cache is disabled.
- Vaul and Sonner styles are extracted into `app/vendor.css`, and narrow build loaders remove their runtime style-block injection. Extraction fixes the pinned Vaul 1.1.2 stray colon in its handle hit-area rule. A separate adapter replaces `react-remove-scroll-bar` style injection with external CSS and a measured numeric scrollbar-width CSS variable. These adapters preserve `style-src 'self'` and fail if their expected dependency source changes.
- `scripts/postbuild.mjs` hashes the emitted Next.js inline bootstrap scripts, adds a narrow same-origin Trusted Types policy before bootstrap, and emits the security header configuration. It also creates dotted aliases for Next's segment-prefetch files so ordinary static hosts can serve App Router navigation requests. It then builds a Serwist service worker with an explicit static precache and no runtime caching.
- PDF generation is loaded when needed. Export burns redactions into opaque pixels after enhancement and before layout or OCR. Enhanced scans embed only fresh rasters; searchable PDFs add the reviewed OCR layer, and clean text PDFs embed only reviewed text and its font. Original image/PDF data and source metadata are never embedded.
- The first-run explainer uses a native modal dialog; editing tools use Vaul. Sonner and import validation load when first needed. Destructive scan actions use Sonner confirmations. The worker bundler resolves only workspace files and installed packages through an explicit source loader, keeping native compilation from scanning unrelated parent directories.

## Hosting

Build once and publish the matching `out/` files and headers together. The CSP hashes are specific to that build; serving stale headers with new HTML can break startup.

| Host | Configuration |
| --- | --- |
| Cloudflare Pages / Netlify | Build command `npm run build`, publish directory `out`. The generated `out/_headers` supplies the required headers. |
| Vercel | The committed `vercel.json` selects the build command and disables framework auto-detection. Postbuild emits `.vercel/output/static` and `.vercel/output/config.json` using Vercel's Build Output API, keeping the HTML and its CSP hashes in the same deployment artifact. |
| Other static host | Publish `out/` and configure the headers recorded in `out/security-headers.json`; a generic file server does not automatically apply them. |

Use HTTPS. Confirm the host preserves CSP, HSTS, Permissions Policy, Referrer Policy, content-type protection, and same-origin resource/opener headers. `npm run preview` provides a local header test; deployment is a separate action and this project setup does not publish anything.

Vercel reads `vercel.json` before the build runs, so postbuild must not put new CSP hashes in that source file. Redeploy the updated source to replace a deployment with stale hashes; simply redeploying the old commit keeps the mismatch. `npm run preview -- --vercel` serves the generated Vercel artifact with its headers for manual browser checks. After redeploying, export any scans in an existing tab before reloading or accepting an app update.

## Airplane-mode acceptance test

Use a production build under `npm run preview` or the intended HTTPS host, not the development server.

1. Load the app online and wait for the real **Offline-ready** status. Allow the initial static precache to finish. Check DevTools Application → Service Workers for the active worker.
2. Open Camera, Editor, Export, and Settings while online. Import one disposable image and complete an export so you know the browser supports the processing path.
3. Close the current temporary session. Disable the network in DevTools, or turn on airplane mode on the device. Keep the app's installed files and browser site data.
4. Reload or reopen the installed PWA. The app shell, fonts, scanner, PDF renderer, and OCR models should load. Import an image and a scanned PDF, crop and enhance a page, redact a field, and export an image and each PDF mode. Recognize English/French text, correct a word, and confirm review before downloading the OCR outputs.
5. Confirm Network shows no third-party requests and no request body or URL containing image data. Any requests for app assets must be served by the service worker while offline.
6. Inspect Cache Storage. Entries should be build assets only, including static language models, with no scan names, thumbnails, originals, recognized text, or export blobs. IndexedDB should contain no scan database or OCR model cache.
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

Also inspect final files with a PDF parser and metadata tool: no EXIF/GPS, blank PDF Author/Creator/Producer, and no original or recoverable content behind redaction. Searchable PDFs intentionally contain reviewed text; verify that redacted content is absent from extraction. Clean text PDFs should contain no scanned images. Print an ID-copy PDF at 100% and measure both sides against 85.6 × 53.98 mm.

Check signature motions on those devices: crop corners move into the real flattened result, filter previews crossfade briefly, compare remains instant, and export completion draws a checkmark. Enable reduced motion and repeat; state changes must remain clear without moving the document or corners.

## Verification status

Historical local verification on 2026-10-17 passed TypeScript, ESLint, 131 unit tests, the static production build, and 12 Edge browser flows. Those browser checks covered scanner/camera behavior, PDF import, offline English/French recognition, cancellation, review gating and corrections, searchable extraction, clean text PDF output, redacted text absence, blank metadata, no document uploads or third-party requests, strict CSP, accessibility, and mobile layout. The npm advisory audit reported zero vulnerabilities. Browser automation was removed on 2026-10-18. After changes, rerun `npm run verify` and the advisory audit, then perform the manual browser and device checks above.

The current build measured 157,222 gzip bytes (153.5 KiB) of initial modern JavaScript, excluding legacy polyfills, lazy processing/editor/export chunks, CSS, HTML, and fonts. Run `node scripts/measure-shell.mjs` to reproduce it. The full static offline precache, including PDF/OCR engines and models, contains 291 assets totaling approximately 28.0 MiB before HTTP compression; this broader download still needs comparison with the spec's budget.

A historical strict-CSP desktop Chrome worker check processed a 12 MP synthetic image at full resolution: Auto rendering took approximately 3.4 seconds, and Document rendering with adjustments, sharpness, rotation, and flip took approximately 8.3 seconds. Those measurements are worker rendering times on a desktop, not capture-to-export timings or proof on the target phones.

Real iPhone and mid-range Android checks, physical print measurement, complete capture-to-export timing, and full app-shell/TTI/live-detection budgets still require measured evidence. Strict-CSP operation and airplane-mode behavior must also be checked on the final deployed host.

Lighthouse numeric scores remain unverified: its browser audit launcher could not run reliably inside this restricted Windows environment. Run Chrome DevTools Lighthouse on the strict preview or HTTPS deployment to check accessibility and best practices against the 95+ target. The installed Lighthouse 13.5 CLI has no separate PWA score category; the offline, service-worker, manifest, and install flows must be checked directly instead.

See [SECURITY.md](SECURITY.md) for the threat model and privacy limits.
