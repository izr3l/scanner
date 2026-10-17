# Mobile Liquid Glass dock: research and implementation decisions

Research date: 2026-10-17. Scope: Vaultscan's Next.js mobile web navigation. This is a web adaptation of Apple's design language; UIKit/SwiftUI's native material renderer is not available to CSS.

## What the Apple references establish

**Material and hierarchy.** Apple's Regular material is appropriate over mixed app content; Clear is intended for richer media and needs additional contrast management. Keep glass in the floating navigation layer while document cards and settings remain ordinary content surfaces. Vaultscan should use a neutral, moderately frosted dock in both themes. [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

**Optical character and selection.** Liquid Glass combines background diffusion, edge definition, lighting, shadow, and responsive movement. Apple discourages stacking separate glass materials: the selected item should be a thin translucent fill within the shared surface. Reduced Motion removes elastic behavior. Our dock will therefore have one filtered surface, a bright rim, a darker outer edge, a soft shadow, and a moving unfiltered selection pill. It will not distort its icon or label foreground. [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)

**Current visual direction.** Apple's WWDC26 refinements strengthen diffusion over complex backgrounds and improve edge/highlight definition. The reference should not be an exceptionally transparent early beta screenshot. Our tint and diffusion prioritize readability over maximum transparency. [Platforms State of the Union, WWDC26](https://developer.apple.com/videos/play/wwdc2026/102/)

**Navigation behavior.** A tab bar represents top-level destinations, with short labels and stable availability. Actions such as the shutter remain separate. Keep actual links for Home, Scan, Edit, Export, and Settings; Export already exists as a desktop destination and deserves a selected state on mobile. The Scan link enters the existing dedicated capture screen, whose shutter and page tray keep their full-screen layout. [Apple HIG: Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)

**Geometry and motion.** Floating capsules should relate to the rounded display and use concentric nested shapes. Our outer capsule and inner selection pill will share consistent padding/radii. Scroll minimization is an optional behavior, not a prerequisite for the material, so the first implementation stays stable while scrolling. [Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/), [SwiftUI automatic minimization behavior](https://developer.apple.com/documentation/swiftui/tabbarminimizebehavior/automatic)

**Touch and safe areas.** Apple calls for safe-area accommodation and usable targets. Native points and CSS pixels are different units; 44 CSS pixels is our minimum web hit target, not a claim about physical equivalence. The dock must leave space for the home indicator and remain usable with larger text. [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple design tips](https://developer.apple.com/design/tips/)

## Web implementation options

| Approach | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| CSS backdrop blur/saturation with layered borders and gradients | Live backdrop, ordinary DOM links, no package or rendering loop | Approximates material; no native optical sampling or lensing | Use as the baseline |
| SVG displacement applied through `backdrop-filter: url(...)` | Can produce refractive lens effects in supporting engines | WebKit's unresolved support issues can discard the filter chain; `CSS.supports` does not establish correct rendering | Exclude from the production dock |
| Canvas/WebGL with DOM snapshots | More control over a simulated lens | Extra rendering, synchronization, assets/dependencies; snapshots of document content are inappropriate for this small navigation surface | Exclude |
| Opaque CSS surface | Predictable contrast and low rendering cost | Less translucent | Use for unsupported filters and accessibility modes |

WebKit's SVG backdrop-filter issue remains relevant to the iPhone target, and its newer tests describe silent failure of chains containing a URL filter. A decorative effect must not determine whether navigation works. [WebKit issue 245510](https://bugs.webkit.org/show_bug.cgi?id=245510), [WebKit issue 317059](https://bugs.webkit.org/show_bug.cgi?id=317059)

CSS backdrop filtering requires transparency to reveal the background. Use literal `-webkit-backdrop-filter` and `backdrop-filter` declarations for older Safari compatibility, behind a feature query, with an opaque default surface. Avoid putting filter values in custom properties because WebKit has reported variable-resolution regressions. Support detection is an enhancement switch, not visual proof on a real phone. [MDN: backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter), [WebKit regression 297620](https://bugs.webkit.org/show_bug.cgi?id=297620)

## Concrete specification for this app

These dimensions and durations are project choices, not Apple-published recipes:

- A centered bottom capsule, maximum width 420 CSS pixels, with at least 12 pixels between it and the safe side edges.
- Approximately 72 pixels tall, including internal padding; five equal link targets remain at least 44 pixels wide at a 320-pixel viewport.
- Bottom gap of 12 pixels plus `env(safe-area-inset-bottom)`. Content, install prompt, and editor actions reserve the same dock footprint.
- One moderate blur/saturation layer. Theme-aware tint controls contrast; highlights and inset shadows suggest curved glass without distorting the content.
- A soft neutral selection fill and green selected icon/label; location is also identified by the pill shape and `aria-current="page"`.
- A short CSS transform transition for the selection pill and subtle press feedback. No continuous shimmer, device-motion tracking, hover-only controls, or mandatory dragging.
- A single persistent component under the root provider allows the selection indicator to move between pages instead of restarting on each AppShell mount. Active state derives from the URL.
- Navigation uses normal Next links in a labeled `nav` landmark. Do not use ARIA `tablist`: these are page destinations rather than tab panels. Decorative layers ignore pointer events.
- While an editable field has focus, a substantial scale-normalized visual-viewport reduction can temporarily hide the dock so it does not cover the keyboard. The inferred calculation is `innerHeight - visualViewport.height * visualViewport.scale > 120`: it cancels ordinary pinch scaling while retaining keyboard shrink during focused-input auto-zoom. This follows the [CSSOM View zoom model](https://drafts.csswg.org/cssom-view/#zooming); it remains a browser heuristic, not a native keyboard API, and needs device validation.

The app already sets `viewport-fit: cover`. Safe-area environment variables provide edge insets; the visual viewport can resize independently of the layout viewport when a keyboard opens. [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/), [MDN: Visual Viewport API](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API)

## Accessibility, security, and rendering constraints

Respect reduced motion by removing travel and press scaling. Under increased contrast, reduced transparency where exposed, or forced colors, strengthen/solidify the surface and preserve a visible selection border. Browser support for reduced-transparency preferences varies; in particular, CSS must not be presented as automatic parity with Apple's native accessibility integration. [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion), [MDN: prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency), [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json)

Target WCAG AA text contrast and visible keyboard focus. Labels remain present, selection is not communicated by color alone, and zoom/reflow must not create horizontal scrolling or clipped links. Forced-color mode should use system colors rather than preserving ornamental gradients. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [WAI navigation landmarks](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html)

Use an external stylesheet and finite class/data-attribute states. Add no inline styles, runtime style injection, external assets, dependencies, document snapshots, storage, or network calls. Preserve the existing strict CSP and matching deployment headers. Keep the filtered area bounded to the small dock; animate transforms/opacity rather than blur radius, layout, or shadows. These decisions reduce rendering work, but are not evidence of a particular frame rate on an iPhone. [web.dev: animation performance](https://web.dev/articles/animations-guide)

## Acceptance evidence

1. On 320-, 390-, 430-, and 844-pixel-wide viewports, every destination fits inside the viewport with usable targets and no horizontal overflow.
2. Real pointer and keyboard activation changes the route; exactly one current destination and one aligned selection pill are shown on every shell page.
3. Light/dark screenshots show readable icons and labels over normal content and scrolled busy content.
4. Reduced motion, increased contrast, forced colors, unsupported filters, and simulated keyboard resizing preserve usable navigation.
5. Editor actions and install prompts sit above the dock; modal sheets remain above it; the dedicated camera screen remains unobstructed.
6. Browser console, page errors, and CSP violation checks stay clean under the generated Vercel artifact.
7. Physical iPhone Safari/PWA testing remains necessary for home-indicator insets, keyboard animation, optical appearance, thermal cost, and frame pacing. Desktop emulation cannot certify these.

## Implementation verification

The production export, TypeScript checks, ESLint, and all 133 unit tests passed. Thirteen targeted Edge browser checks passed against the generated Vercel artifact: seven dock checks, four deployment/navigation checks, and the two existing full mobile-page accessibility flows. Coverage includes persistent selection across routes, 320/390/430/844-pixel layouts, doubled root text size, simulated keyboard/pinch/auto-zoom changes, both themes, contrast/transparency/forced-color preferences, camera/desktop separation, and editor/install-prompt clearance. CSP and browser error monitors stayed clean. The local Windows browser runner needed interruption after all assertions passed because teardown stalled.

Light and dark screenshots were visually inspected. `node scripts/measure-shell.mjs` measured 157,222 gzip bytes of initial modern JavaScript for the resulting app shell. This is a whole-shell measurement, not a dock-only profile or an iPhone frame-rate result. No new package was installed. Physical Safari validation remains outstanding as described above.
