#Scanner: Secure Document Scanner PWA

*Build spec for Claude Code / Cursor. Working name: **Scan** (rename freely).*

## 1. Product summary

A privacy-first Progressive Web App that scans documents, ID cards, and passports with the phone camera, auto-detects and flattens the page, enhances it, arranges it on a page, and exports PDF, PNG, JPEG, or WebP. **Everything runs on-device. No uploads, no accounts, no analytics in v1.**

**Design pillars**

1. **Trust:** the UI constantly, quietly signals that nothing leaves the device.
2. **Speed:** capture to export in under 10 seconds for a single page.
3. **Craft:** premium feel through restrained color, precise typography, and purposeful motion.

## 2. Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router), TypeScript, **static export** (`output: 'export'`) so there is no server attack surface |
| Styling | Tailwind CSS + shadcn/ui (customized to the tokens below) |
| State | Zustand |
| Motion | `motion` (Framer Motion successor) for springs and gestures; CSS transitions for everything simple |
| Toasts / sheets | Sonner, Vaul (both by Emil Kowalski) |
| PWA | Serwist (service worker, precache, offline) |
| CV | OpenCV.js (WASM) in a Web Worker, **self-hosted**, lazy-loaded. Optional fast path: jscanify |
| PDF | pdf-lib (multi-page, page sizes, metadata control) |
| Storage | IndexedDB (via `idb`) + WebCrypto encryption |
| OCR (v2) | Tesseract.js, self-hosted, for passport MRZ and searchable PDFs |
| Fonts | Syne (display), Inter (UI), JetBrains Mono (metadata, dimensions, file sizes), self-hosted via `next/font` |

## 3. Core features

### 3.1 Capture

- Live camera via `getUserMedia` (rear camera, highest practical resolution, `ideal` constraints with fallback).
- Fallback: `<input type="file" accept="image/*" capture="environment">` (more reliable on some iOS versions). Also support gallery import and drag-and-drop on desktop.
- **Live edge overlay:** run detection on a downscaled frame (\~640 px long edge) at \~10 fps in a worker, drawing the detected quad over the video.
- **Auto-capture:** when the quad is stable for \~700 ms (corner drift under a small threshold), a progress ring fills and the shutter fires. Manual shutter always available.
- **Quality gates** before accepting a shot: blur (Laplacian variance), glare (blown-out highlight blob inside the quad), low light. Show a calm inline hint, never a blocking error.
- Modes: **Document**, **ID Card** (locked to ID-1 ratio 85.6 × 53.98 mm, guide frame), **Passport** (locked to TD3 data page 125 × 88 mm), **Book/Multi-page** (keeps camera open and stacks pages), **Batch**.
- Torch toggle where `ImageCapture`/track constraints support it.

### 3.2 Detection and flattening

Pipeline (worker, downscaled copy):

1. Grayscale, Gaussian blur, Canny, dilate.
2. `findContours`, `approxPolyDP`, keep the largest convex 4-point polygon above a minimum area ratio.
3. Score candidates (area, aspect ratio against the selected mode, rectangularity). Fallback to inset rectangle if nothing is found.
4. Map corners back to full resolution, order them (TL, TR, BR, BL).
5. `getPerspectiveTransform` + `warpPerspective` on the **full-resolution** image to an output size derived from the quad edges (or the locked ratio for ID/passport).

The user can drag four corner handles with a magnifier loupe, nudge with arrow buttons, and tap **Auto** to re-detect.

### 3.3 Enhancement

- Filters: **Original**, **Auto**, **Document** (adaptive threshold, shadow removal), **Black & White**, **Grayscale**, **Color boost**.
- Sliders: brightness, contrast, sharpness. Straighten (fine rotation), rotate 90°, flip.
- Non-destructive: store the original, the corners, and an edit recipe; re-render on demand.
- **Before/after hold-to-compare.**

### 3.4 Arrange ("place it very well")

- Page presets: A4, Letter, A5, ID-1, Passport, Custom, plus margin and orientation.
- **ID copy layout:** front and back of a card placed on one A4 page, centered, true physical size (85.6 × 53.98 mm), with optional cut-guide crop marks.
- Fit modes: fit, fill, actual size. Auto-center and auto-orient (portrait vs landscape pages).
- Multi-page reorder (drag), delete, duplicate, per-page filter.

### 3.5 Protect before sharing (security-driven features)

- **Metadata stripping:** all exports are re-encoded from the canvas, so EXIF and GPS are never carried over. PDFs get blank Author, Creator, and Producer.
- Optional password-protected PDF (evaluate a WASM encryption library; if none is trustworthy, ship without and say so in the UI).

### 3.6 Export

- Formats: **PDF** (single or multi-page), **PNG**, **JPEG** (quality slider), **WebP**.
- Options: page size, DPI (150 / 200 / 300), quality, filename template (`{type}-{date}`), live estimated file size.
- Delivery: Web Share API with files (preferred, no server link), download fallback, copy-to-clipboard for single images.

### 3.7 Vault (local library)

- NONE, I don't want to have any storage

### 3.8 v2 ideas

Passport MRZ read and validation (ICAO check digits) fully offline, OCR searchable PDF, auto-classify document type, signature-from-photo tool, WebAuthn-gated Vault.

## 4. Security spec

**Threat model (be explicit in `SECURITY.md`):** Protect against (a) network or server exposure, (b) malicious third-party code and XSS, (c) casual access to an unlocked or borrowed phone, (d) accidental leakage via metadata or sharing. **Not** protected against: a fully compromised device, OS-level screenshots or screen recording, or a user sharing the file themselves. Say this honestly in-app.

### 4.1 No-egress architecture

- Static export, zero API routes, zero server actions.
- `connect-src 'self'` only; the app physically cannot POST scan data anywhere. No analytics, no error reporters, no CDN scripts, no remote fonts or images.
- A visible **"Offline-ready, nothing leaves this device"** indicator tied to real service-worker status. Include a documented "airplane mode test" in the README.

### 4.2 HTTP headers (set at the host; Cloudflare Pages, Netlify, or Vercel config file)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

If Next's inline bootstrap scripts conflict with a strict `script-src`, use build-time hashes (or move to a nonce-capable host config). Do not weaken to `'unsafe-inline'`. Add a CSP `<meta>` fallback only as a last resort.

### 4.3 Encryption at rest

- Vault records (image blobs + metadata) are encrypted with **AES-256-GCM** via WebCrypto, with a fresh random 96-bit IV per record.
- Key hierarchy: a random **data key** (non-extractable `CryptoKey`) is wrapped by a **key-encryption key** derived from the user's passcode (Argon2id via a vetted WASM build; PBKDF2-SHA256 at 600k+ iterations as fallback). Optional unlock via **WebAuthn with the PRF extension** (Face ID / fingerprint) where supported.
- **Auto-lock:** after 60 s in background (`visibilitychange`), on inactivity timeout, and on demand. Locking drops key references and clears in-memory canvases.
- Failed-attempt backoff, plus an optional "wipe after N failures".
- **Panic wipe:** one control that deletes IndexedDB, Cache Storage, and unregisters the service worker.
- Request `navigator.storage.persist()` so the browser does not evict the Vault.

### 4.4 Handling images in memory

- Prefer `ImageBitmap` and `OffscreenCanvas` in workers; release with `bitmap.close()` and zero canvas dimensions when done.
- Revoke every `URL.createObjectURL` immediately after use.
- **Never** put scans in the Cache API or service-worker caches; the service worker precaches static assets only.
- Stop all `MediaStreamTrack`s when leaving the camera view or when the page is hidden.
- Never log image data or file names to the console in production builds.
- Do not persist the draft session by default for ID and passport modes.

### 4.5 Supply chain and code safety

- Self-host OpenCV.js, WASM, Tesseract data, and fonts; pin exact versions; commit the lockfile; `npm ci` in CI; `ignore-scripts` where possible; `npm audit` and an SCA scan in CI.
- Subresource-integrity hashes on any self-hosted worker or WASM artifacts that are fetched at runtime, verified before use.
- Minimal dependency footprint; review any package touching crypto or PDF.
- Validate imports: check MIME by magic bytes, cap dimensions and file size, decode defensively in a worker (guards against decompression-bomb images).
- Lint rules banning `dangerouslySetInnerHTML`, `eval`, and `new Function`. Use Trusted Types policy for any unavoidable DOM sinks.

### 4.6 Privacy UX

- First-run explainer (3 short screens) covering what stays on device, what the Vault does, and the limits.
- Settings → **Privacy**: default watermark text, strip-metadata (locked on), auto-lock timer, Vault on or off, panic wipe.
- Use `Sonner` confirmations for destructive actions with an undo window only for non-sensitive deletes; secure deletes are final.
- Optionally blur the app preview in the OS task switcher by covering the UI on `visibilitychange` (best effort; document the platform limits).

## 5. Visual design system

**Direction:** dark-first, quiet and confident, like a well-made vault door. Light theme is a warm paper variant. Color is used sparingly: one accent that means "verified, safe, active."

### 5.1 Color tokens (define as CSS variables, OKLCH preferred)

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `#0A0B0F` | `#F6F4EF` |
| `--surface` | `#12141A` | `#FFFFFF` |
| `--surface-raised` | `#1A1D26` | `#FBFAF7` |
| `--border` | `rgba(255,255,255,.08)` | `rgba(20,20,30,.09)` |
| `--text` | `#F2F3F7` | `#14151A` |
| `--text-muted` | `#8B90A0` | `#6B6F7B` |
| `--accent` (emerald) | `#3DDC97` | `#10A970` |
| `--accent-glow` | `rgba(61,220,151,.28)` | `rgba(16,169,112,.18)` |
| `--warning` | `#FFB84D` | `#C77700` |
| `--danger` | `#FF6B6B` | `#D13B3B` |

Rules: accent only for the detected-edge overlay, primary CTA, success states, and the "secure" indicator. Use soft inner highlights (1px top border at 6–8% white) and layered shadows for depth instead of heavy gradients. A very subtle noise or grain texture on the background at 2–3% opacity is optional. Verify WCAG AA contrast for text and controls.

### 5.2 Typography

- **Syne** for large titles and the empty states (weight 600–700, tight tracking).
- **Inter** for UI text (sizes 13/15/17, `font-feature-settings: 'cv11', 'ss01'`).
- **JetBrains Mono** for dimensions, DPI, file sizes, and the MRZ view.
- Tabular numbers for anything that changes live.

### 5.3 Layout

- Mobile-first, one-handed: primary actions in the bottom thumb zone; safe-area insets respected (`env(safe-area-inset-*)`).
- Camera view is full-bleed with minimal chrome: shutter (center), gallery (left), torch and mode (right), mode selector as a horizontal snap-scrolling pill row.
- Editing screens use a fixed preview area plus a **Vaul** bottom sheet for tools (snap points at peek, half, and full).
- Desktop: two-pane layout (preview and tool panel); same components.
- Radius scale 10 / 14 / 20 / 28; consistent 4-pt spacing grid.

## 6. Motion spec (Emil Kowalski principles)

The guiding idea is *invisible* animation: it should make the app feel responsive and physical, never decorative. Apply these rules everywhere:

1. **Animate with purpose.** Skip animation for high-frequency or keyboard-driven actions. Spend the motion budget on moments that matter: capture, snap-to-edge, export complete.
2. **Keep it fast.** UI transitions 150–250 ms; sheets and large surfaces up to \~350 ms. Nothing in the main flow blocks the user.
3. **Use strong custom easing, not browser defaults.** Define tokens:
   - `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for entrances and most UI
   - `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement
   - `--ease-sheet: cubic-bezier(0.32, 0.72, 0, 1)` for drawers
   - Avoid `ease-in` for UI (it feels sluggish).
4. **Never animate from nothing.** Enter from `scale(0.95)` plus `opacity: 0`, not `scale(0)`.
5. **Pressed state on every tappable element:** `transform: scale(0.97)` on `:active`, with a quick press-in (\~100 ms) and slightly slower release.
6. **Be origin-aware.** Popovers and menus scale from their trigger (`transform-origin`), not from center.
7. **Prefer interruptible CSS transitions** over keyframes for interactive state, so rapid taps never produce janky restarts. Use springs (`motion`) only for gestures and drag.
8. **Animate only `transform` and `opacity`** (plus `clip-path` for reveals) to stay on the compositor. Avoid animating layout properties.
9. **Stagger lightly:** 30–60 ms between list or grid items, capped so long lists do not feel slow.
10. **Respect `prefers-reduced-motion`:** replace movement with fades; keep state changes clear without motion.

### Signature moments

| Moment | Behavior |
| --- | --- |
| Edge detection | Quad outline eases to new corners (\~120 ms) instead of jumping; soft emerald glow, no flicker |
| Auto-capture | Progress ring fills over the stability window; on fire, a brief white flash (60 ms) and the frame shrinks toward the thumbnail slot |
| Capture to crop | Shared-element transition: the captured frame becomes the crop view (View Transitions API with a fallback) |
| Flatten | Corners animate to the rectangle, the image perspective-warps into place (\~300 ms ease-out) so the user *sees* what happened |
| Filter switch | Cross-fade with a 4 px blur-to-sharp mask (\~180 ms) |
| Hold to compare | Instant swap (no animation); high-frequency, so it should feel immediate |
| Bottom sheets | Vaul spring/drag with `--ease-sheet`, velocity-based dismissal, rubber-banding at edges |
| Page reorder | Layout animation with spring; lifted item scales to 1.03 with a deeper shadow |
| Export success | Checkmark path-draw (\~350 ms) and a Sonner toast; no confetti |
| Vault lock/unlock | Shackle-style icon morph, \~250 ms; content fades and blurs on lock |
| Toasts | Sonner defaults, restyled to the tokens |

Tooltips (desktop) use a short delay on first open and none when moving between adjacent tooltips.

## 7. Architecture

```
Scanner/
├─ app/
│  ├─ layout.tsx            # fonts, theme, providers
│  ├─ page.tsx              # home / library
│  ├─ scan/page.tsx         # camera
│  ├─ edit/[id]/page.tsx    # crop → enhance → arrange
│  ├─ export/[id]/page.tsx
│  ├─ vault/page.tsx
│  └─ settings/page.tsx
├─ components/
│  ├─ camera/  (Viewfinder, QuadOverlay, ShutterButton, ModePills)
│  ├─ editor/  (CornerHandles, Loupe, FilterStrip, Sliders, CompareButton)
│  ├─ layout/  (PageCanvas, PresetPicker, PageList)
│  ├─ privacy/ (WatermarkTool, RedactTool, SecureBadge, PanicWipe)
│  └─ ui/      (shadcn primitives, restyled)
├─ lib/
│  ├─ cv/       # worker.ts, detect.ts, warp.ts, enhance.ts, quality.ts
│  ├─ crypto/   # kdf.ts, vault.ts, webauthn.ts, lock.ts
│  ├─ export/   # pdf.ts, image.ts, watermark.ts, redact.ts, strip.ts
│  ├─ db/       # idb schema, encrypted repo
│  ├─ presets.ts # page sizes, ID-1, TD3
│  └─ motion.ts # easing + duration tokens, variants
├─ stores/      # session, settings, vault (Zustand)
├─ public/      # opencv.js/wasm (self-hosted), icons, manifest
├─ sw.ts        # Serwist, static precache only
├─ headers config (host-specific)
├─ SECURITY.md
└─ README.md
```

**Data model:** `Scan { id, type, createdAt, originalBlobRef, corners[4], recipe{filter, brightness, contrast, sharpness, rotation}, redactions[], pages[] }`. Originals and thumbnails are encrypted when stored in the Vault.

**Performance budget:** app shell under 150 KB gzipped (excluding OpenCV); OpenCV lazy-loaded after first interaction on the scan screen and cached; time to interactive under 2 s on a mid-range phone; detection under 60 ms per frame; handle 12 MP+ images using tiling or downscale-then-warp.

**PWA:** manifest (name, icons incl. maskable, `display: standalone`, theme color per scheme, `share_target` for receiving images optional), offline-first shell, install prompt shown only after the first successful scan, update toast when a new service worker is waiting.

## 8. Build order

1. **Foundation:** Next.js static export, tokens, fonts, theme, shadcn restyle, Serwist, headers and CSP (verify in a strict-CSP dev build from day one).
2. **Camera and capture:** `getUserMedia`, file-input fallback, permissions UX, mode pills.
3. **CV worker:** OpenCV load, detection pipeline, live overlay, quality gates, auto-capture.
4. **Crop and flatten:** corner handles, loupe, full-res warp, presets.
5. **Enhance:** filters, sliders, compare, non-destructive recipe.
6. **Arrange and export:** page layouts, ID copy layout, multi-page, PDF/PNG/JPEG/WebP, share.
7. **Protect:** watermark, redaction, metadata stripping, privacy settings.
8. **Vault:** encryption, lock/unlock, auto-lock, panic wipe, library UI.
9. **Polish:** motion pass against Section 6, reduced-motion, a11y, haptics (`navigator.vibrate` where available), empty and error states.
10. **Hardening:** security review against Section 4, dependency audit, real-device test matrix (iOS Safari PWA, Android Chrome, desktop), airplane-mode test.

## 9. Acceptance criteria

- Works fully offline after first load; verified with network disabled.
- Network tab shows **zero** third-party requests and no request carrying image data.
- Exported files contain no EXIF/GPS; redactions cannot be reversed from the file.
- ID card scan flattens to correct aspect ratio within 1% and prints at true size on A4.
- Vault contents are unreadable in DevTools (IndexedDB shows only ciphertext) and the app locks within the configured time.
- Lighthouse PWA, accessibility, and best-practices scores 95+; CSP reports no violations.
- All interactive elements are keyboard and screen-reader operable; reduced-motion honored.
- Tested on a real iPhone (installed PWA) and a mid-range Android device.

## 10. Open questions for the build

- Ship password-protected PDF in v1 or wait for a vetted library? wait for a vetted library
- Is MRZ reading in scope for v1 or v2? It's for V2
