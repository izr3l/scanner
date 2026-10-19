# Mobile navigation: Landmarks research and web adaptation

Research date: 2026-10-19. Scope: the supplied Apple Landmarks sample and Vaultscan's mobile web navigation. CSS can approximate the appearance of the native material; this implementation does not reproduce SwiftUI's adaptive lensing renderer.

The reference sample is kept locally and excluded from this repository. Obtain it from Apple's [Landmarks: Building an app with Liquid Glass](https://developer.apple.com/documentation/swiftui/landmarks-building-an-app-with-liquid-glass) article. Source paths below are relative to the sample's `Landmarks/Landmarks/` directory.

## What the supplied sample actually implements

- **Native navigation.** Landmarks uses `NavigationSplitView` and `NavigationStack`, with three sidebar destinations. There is no `TabView`, custom bottom dock, or tab minimization implementation in this source. See `Views/Landmarks Split View/LandmarksSplitView.swift:18` and `Views/Landmarks Split View/NavigationOptions.swift:19`.
- **Functional toolbar groups.** The detail toolbar separates Share, a Favorites/Collections group, and Info with fixed spacers. This is evidence for grouping related controls and separating different functions; it is not a sample dock recipe. See `Views/Landmarks/Landmark Detail/LandmarkDetailView.swift:39`.
- **Shared custom glass.** The badges use one `GlassEffectContainer`, regular glass on rounded rectangles, and stable `glassEffectID` values. The toggle uses the native glass button style; expansion changes under `withAnimation`. The only explicit `.tint(.clear)` is conditional on macOS. No explicit iOS glass tint or `.interactive()` modifier appears in the sample. See `Views/Badges/BadgesView.swift:18`.
- **Content behind navigation.** The hero image uses `backgroundExtensionEffect`; the surrounding scroll view extends into the top safe area. Its geometry modifier stretches the hero during overscroll rather than hiding controls. See `Views/Landmarks/Landmark Detail/LandmarkDetailView.swift:23` and `Views/Landmarks/FlexibleHeader.swift:20`. Bottom toolbar placement is native. The declared `safeAreaPadding` constant is unused and supplies no web inset specification.

The download contains source, content photographs, and icon assets, but no UI screenshots or video. The [Landmarks article linked by its README](https://developer.apple.com/documentation/swiftui/landmarks-building-an-app-with-liquid-glass) provides the rendered reference.

Apple recommends reserving glass for navigation and controls, avoiding glass stacked on glass, using thin fills for elements inside a glass surface, and applying color selectively. Native glass also responds to accessibility settings. These principles support a restrained shared navigation surface; they do not supply CSS opacity or blur values. [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)

Apple's SwiftUI session demonstrates native toolbar grouping and custom glass containers. Those APIs explain the sample's composition; browser filters remain a separate implementation choice. [Build a SwiftUI app with the new design, WWDC25](https://developer.apple.com/videos/play/wwdc2025/323/)

## Vaultscan implementation choices

These are project decisions inferred from the reference, not Apple-published dimensions or a literal port:

- Home, Edit, Export, and Settings share one lighter neutral capsule. Scan has a separate circular link after a fixed 10px gap, distinguishing capture from workspace destinations.
- The row is nominally 64 CSS pixels tall, grows with root text size, has a maximum width of 440px, and keeps 16px side spacing plus safe-area insets. Its bottom gap is 12px plus the home-indicator inset.
- A thin rim defines each surface. The selection is a thin translucent fill moving inside the capsule, without its own normal-state border or shadow. Green emphasizes the active destination's foreground. Labels and icons remain unfiltered.
- The capsule and Scan control are two neighboring, isolated backdrop surfaces. Each uses CSS `blur(20px) saturate(1.6)`, theme-specific translucent color, and a restrained highlight. No nested backdrop filter, double outline, SVG URL filter, WebGL, document snapshot, new package, or rendering loop is needed.
- Actual links, visible labels, `aria-current`, keyboard focus, and at least 44px hit targets preserve navigation semantics. Decorative layers cannot intercept pointers. Route state controls selection; the component remains mounted between shell pages.
- Navigation stays visible while scrolling. Footer content, editor actions, install prompts, and notifications share its clearance. Editor sheets stay above it; capture retains its dedicated screen. Existing keyboard-aware visibility is preserved.
- An opaque surface is the default when backdrop filters are unavailable. Reduced transparency and increased contrast use a solid surface; forced colors use system colors. Reduced motion removes selection travel and press motion. Browser support for these preferences varies, so native accessibility parity is not assumed.
- Styles stay in the external stylesheet with finite class/data states, preserving the strict CSP. No inline style injection, network request, or persistent document data is introduced.

## Verification status

On 2026-10-19, `npm run verify` passed type checks, lint, all 135 unit tests, and the production build. The generated Vercel preview was inspected in dark and light themes at 390px, and in dark mode at 320px. At 320px with a browser scrollbar, the four navigation targets measured 47.7 × 56px and Scan measured 64 × 64px; the document had no horizontal overflow. Pointer navigation and keyboard activation of Export selected the corresponding route. The redesigned app was activated through its normal update control. A synthetic PDF imported and opened in the editor through the dock.

Follow-up visual inspection of the editor stalled, so its clearance remains a manual check alongside landscape, enlarged text, keyboard behavior, and accessibility preference modes. Source review checked selection geometry, fallback specificity, shared editor clearance, and listener cleanup. Physical iPhone Safari/PWA validation remains necessary for optical appearance, safe-area positioning, and keyboard behavior. Desktop browser checks do not establish native rendering parity.

Playwright, automatic browser QA, and generated QA artifacts are not part of this revision.
