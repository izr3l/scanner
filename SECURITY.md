# Security and privacy

Vaultscan is a static, on-device scanner. There are no accounts, application server, upload endpoint, analytics, error reporters, or third-party runtime scripts. This implementation follows the owner's explicit clarification: **no scan storage and no Vault features**. Scan originals, corners, recipes, redactions, previews, and settings live in the current page's memory. Closing or reloading the app discards that temporary session; the browser and operating system control actual memory reclamation.

## Threat model

| Threat | Controls and limits |
| --- | --- |
| Network or application-server exposure | Images are processed by a local worker. The app issues only same-origin requests for its own static assets. No application API or scan-upload code exists. CSP restricts connections to the app origin. |
| Malicious third-party code or XSS | Dependencies are exact-version locked. Fonts and the combined OpenCV/WASM worker are self-hosted. The complete worker bytes are checked against a generated SHA-256 digest before execution. Strict CSP and narrow Trusted Types policies reduce executable injection paths; lint forbids unsafe HTML and JavaScript code generation in project code. These controls do not make dependencies or a compromised hosting origin inherently trustworthy. |
| Casual access to an unlocked or borrowed device | The app offers a temporary workspace and session clearing, stops camera tracks when hidden or left, and covers the UI when hidden as a best effort. There is no passcode or auto-lock because the Vault was removed. Someone with access to an open, unlocked session may still view its scans. Export or clear the session before handing over the device. |
| Accidental metadata or sharing leakage | Exports are encoded from fresh pixels. EXIF/GPS and original metadata are not forwarded. PDFs have blank Author, Creator, and Producer and contain only flattened rasters. Redactions become opaque pixels before layout and export. Sharing requires a user action and sends files through the browser/OS share interface. |

A fully compromised device, hostile browser extension with sufficient access, OS screenshots or screen recording, and files the user chooses to share are outside this protection. An OS task-switcher snapshot may occur before the visibility cover is painted. The application cannot guarantee physical erasure from browser memory, swap, caches controlled by the OS, the clipboard, downloaded files, backups, or other applications.

## Data lifetime

- The session and settings stores have no persistence middleware. There is no IndexedDB, localStorage, saved draft, encrypted scan database, or browser storage-persistence request.
- Original imported files may contain private metadata in memory. Exporting uses a fresh canvas raster rather than returning or embedding that original blob.
- The service worker precaches only the site's static build manifest. It has no runtime caching routes; scans and export blobs never enter Cache Storage.
- Processing closes ImageBitmaps, deletes OpenCV matrices, and zeros temporary canvas dimensions. Blob URLs are revoked once their consumer has used them; downloads keep a URL briefly alive so asynchronous browser download dispatch can consume it.
- Camera tracks are stopped when leaving the camera screen or when the document is hidden. A native camera-input fallback is managed by the browser and operating system.
- Clearing a session releases application references. It does not delete previously downloaded/shared files or promise forensic erasure.

## Import and export boundary

JPEG, PNG, and WebP are validated by their file signatures and encoded dimensions instead of trusting extensions or MIME labels. Known MIME labels must match those bytes; the JPEG `image/jpg` alias is accepted. An empty or generic binary MIME label is checked by its content. Inputs are limited to 32 MiB, 40 megapixels, and a 16,384-pixel edge. The same validator runs before worker decoding, and the resulting bitmap dimensions are checked again before CV processing. Malformed containers may still be rejected by the browser decoder after header validation. This is a defensive boundary, not a substitute for browser decoder security updates.

Perspective flattening works from the original scan and edit recipe. Redactions use normalized coordinates on the final flattened/rotated output. Export paints them with full opacity after enhancement and before any page composition. The original is never embedded as a recoverable PDF layer; watermark text is also rendered into the output raster. PDF metadata identification fields are blank, with no source creation/modification date copied. PNG print density and JPEG JFIF density describe the chosen DPI without adding EXIF. WebP exports do not add EXIF.

PDF password encryption is not implemented. The UI states that it awaits a vetted library. OCR and passport MRZ processing are not v1 capabilities.

## Content Security Policy and hosting

`scripts/headers.mjs` defines the security policy. `scripts/postbuild.mjs` hashes the actual emitted inline Next.js bootstrap scripts and generates `out/_headers`, `out/security-headers.json`, and root `vercel.json`. Script policy permits the app origin, build-specific hashes, and `wasm-unsafe-eval` for WebAssembly compilation. It never adds `unsafe-inline`, JavaScript `unsafe-eval`, or blob execution to `script-src`.

During preparation, `scripts/opencv-csp.mjs` replaces the pinned engine's generated embind and emval invokers with closure implementations. OpenCV and its embedded WASM become part of the scanner worker artifact. The main thread verifies that complete artifact against `lib/asset-integrity.ts` before creating the blob worker, which `worker-src` permits. The worker uses its bundled engine; it does not fetch another runtime or call `importScripts`. The separately generated `public/cv/opencv.js` exists for build/test use and is removed from `out/`, so the production service worker caches only one copy of the engine. An upstream upgrade requires reviewing the patch and rerunning strict-CSP checks.

Vaul and Sonner CSS is extracted at build time into an external stylesheet, while targeted loaders strip runtime style-block injection. The extraction also fixes a stray colon in the pinned Vaul 1.1.2 handle hit-area rule. The `react-remove-scroll-bar` adapter uses external CSS and sets only a measured numeric scrollbar-width custom property through CSSOM, restoring it on cleanup. These source-sensitive adapters preserve `style-src 'self'`; they fail when the expected pinned source layout changes and require review on dependency upgrades.

The Trusted Types default policy accepts only framework script paths under `/_next/static/` and `/sw.js` on the same origin, plus empty HTML for framework clearing operations. The scanner worker policy accepts only locally generated blob URLs created from verified worker bytes. There is no separate runtime-import policy. No arbitrary HTML is permitted.

Postbuild emits static dotted aliases for Next's segment-prefetch files, allowing App Router navigation on ordinary static hosts without a server endpoint. These aliases contain framework build data and are included in the static precache.

Other headers set HSTS, camera-only permissions, no referrer, content-type protection, and same-origin opener/resource policy. `connect-src 'self'` restricts the destination origin; it does not alone prohibit same-origin requests. The application contains no scan-upload operation, and a static host must not be configured to add one.

Deploy the matching HTML, assets, service worker, and generated headers together over HTTPS. Check the actual hosted response headers and console; a development server or generic static file server does not establish CSP compliance. Do not weaken CSP to suppress integration errors. Cached app updates should be applied after finishing and exporting the current temporary session.

## Supply chain checks

Use the committed lockfile and `npm ci --ignore-scripts`. The project-owned asset preparation script is explicit, runs locally at build time, and copies assets from installed pinned packages. Runtime fetch verifies the exact combined worker bytes, including the OpenCV engine and embedded WASM payload. This detects an artifact mismatch but cannot defend against an attacker who can replace both the app and its expected hash.

The Verify workflow runs typecheck, lint, unit tests, a static build, production browser checks, and `npm audit --audit-level=high`. The local advisory audit performed during this build reported no vulnerabilities; rerun it after dependency changes or before release. Pull requests also run [GitHub Dependency Review](https://github.com/actions/dependency-review-action), pinned to the verified [v4.8.3 release commit](https://github.com/actions/dependency-review-action/commit/05fe4576374b728f0c523d6a13d64c25081e0803), for changed dependency vulnerabilities. Dependency Review requires the repository's dependency graph and applicable GitHub security features; enable them before treating that CI check as active. A manifest inspection or configured workflow is not evidence of a clean current scan.

## Required release evidence

Record strict-CSP browser results, zero-third-party/no-image-network-request observations, cache/database inspection, final-file metadata/redaction inspection, offline reload/export, and real iPhone/Android lifecycle checks. After a production build, `npm run test:browser` uses existing Edge on Windows or an installed Playwright Chromium on Linux/CI (`npx playwright install --with-deps chromium`). Its synthetic test fixtures, traces, screenshots, and exports stay under ignored `.qa/`. `node tests/cv-worker.mjs` is an optional standalone worker check using installed Chrome on Windows.

Follow the airplane-mode and device procedures in [README.md](README.md). Desktop Chrome measurements for a full-resolution 12 MP synthetic scan were about 3.4 seconds for Auto rendering and 8.3 seconds for an adjusted Document render. Those results establish a desktop worker path only. Real iPhone/mid-range Android behavior, complete capture-to-export timing, physical ID-size print checks, Lighthouse scores, and the remaining performance budgets require their own measurements; local compilation and desktop browser checks do not establish them.
