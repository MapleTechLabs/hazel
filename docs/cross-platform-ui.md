# Cross-platform UI: one view, native renderers

Status: phase 0 spike done (branch `t3/cross-platform-ui-spike`), see "Spike results".

## Goal

Every screen has one Foldkit view. The view says what is on screen in a small, platform-neutral
vocabulary, and each platform draws it with its own components: the DOM on the web, SwiftUI on iOS
(and macOS); the Tauri app keeps the web view on desktop. Model, update, routing and data stay shared as they are.

Rune (the GPU renderer, since removed) and the WebView hybrid both tried to make one _web_ view pass as native: Rune by emulating HTML
and CSS (a long tail of bugs), the hybrid by staying web (not native). Neither reaches native. A view
that describes _what_ it shows rather than _how the web draws it_ can.

## Decisions

1. **Primitives annotate the HTML, they don't replace it.** A kit element keeps the markup and
   classes the web draws, and also says what it is: `data-ui="item"` and typed props in
   `data-ui-props` (`apps/web-foldkit/src/ui/semantic.ts`), as native islands (`data-native=...`)
   already do. The web cannot regress; a native renderer reads only the semantic attributes, and
   what has none is visibly unconverted to it.
2. **Platform differences live inside primitives, never in pages.** `menu` is a popover on the web
   and `UIMenu` on iOS; `tabBar` is the rail on wide web and a Liquid Glass bar on iOS. A page never
   asks which platform it is on. One counted escape hatch: `webOnly(...)`.
3. **Unconverted screens fall back to the web view** inside the native navigation stack
   (`apps/ios-hybrid`), so the whole app works on iOS from the start and screens convert one by one.
4. **One wire for native renderers.** Generalize the wire Rune used (`packages/foldkit-rune`, removed: see git history; stable paths,
   handler ids, unchanged subtrees by reference) into `packages/foldkit-native`, carrying semantic
   nodes instead of CSS, fed by Foldkit's `RenderTarget`, for the SwiftUI host.
5. **Native owns the hot paths.** Scrolling, typing, gestures and animation never wait on JS. Lists
   get row data with stable ids; text fields own their text while editing (revisioned echoes);
   swipe-back completes natively, then sends a Message.

## Vocabulary (v1, about 25)

| Group       | Primitives                                                                               |
| ----------- | ---------------------------------------------------------------------------------------- |
| Layout      | `stack`, `spacer`, `scroll`, `frame`, `divider`                                          |
| Collections | `list` (keyed rows, sections, reach start/end, stick to bottom), `grid` later            |
| Content     | `text`, `heading`, `icon` (web SVG + SF Symbol), `image`, `avatar`, `badge`, `richText`  |
| Controls    | `button`, `link`, `textField`, `textArea`, `toggle`, `select`, `searchField`, `composer` |
| Overlays    | `menu`, `contextMenu`, `sheet`, `dialog`, `popover`, `toast`                             |
| Structure   | `navigation` (from the route), `screen` (title, toolbar, back), `tabBar`, `splitView`    |

Tokens (spacing, semantic colors, type, radii) come from `theme.css` and are exported to Swift. A primitive lands only with every renderer it targets and a conformance test.

## Phases

0. **Proof** (done): semantic attributes, the channel list converted, a SwiftUI renderer.
1. **Foundation** (2–3 weeks): `packages/foldkit-native` on `RenderTarget` (no DOM), tokens export,
   `navigation`/`screen`/`tabBar`/`splitView` with route ↔ `NavigationStack`, web view fallback,
   `no-raw-layout` lint with a ratchet baseline and a per-screen "native-ready" report.
2. **Core loop** (4–6 weeks): channel (`list` of messages, `richText`, attachments, reactions,
   `contextMenu`), the composer (platform-neutral state; ProseMirror on web, a native text view on
   iOS), threads, activity. Geometry Mounts move inside the primitives. TestFlight.
3. **Breadth**: search and palette, profiles, sheets and dialogs, form primitives (SwiftUI `Form`).
   Long-tail screens convert when touched.
4. **Desktop**: macOS through the SwiftUI renderer (`splitView`); Windows and Linux stay on Tauri.
5. **Finish**: `no-raw-layout` to zero, fallback removed.

## Risks

| Risk                            | Mitigation                                                               |
| ------------------------------- | ------------------------------------------------------------------------ |
| Web regressions                 | Annotate, don't replace; visual diffs on converted screens               |
| Vocabulary bloat                | Every renderer plus a conformance test per primitive; extend props first |
| Bridge cost on large channels   | Row data, native hot paths, measured on device in phases 0 and 2         |
| Rich text and composer are deep | Their own milestones; the web fallback keeps everything usable meanwhile |

## Spike results (phase 0)

What was built:

- `apps/web-foldkit/src/ui/semantic.ts`: `screen`, `section`, `item`, `action`.
- The channel list annotated where it is built (sidebar screen, sections, channel/DM/thread rows,
  the "+" actions): about 60 lines over five files, no markup or class changed. All 2716 web tests
  pass.
- `apps/ios-hybrid`: the web app in a `WKWebView` (offline fixture), `web/semantic-tree.ts` reads the
  semantic tree, `NativeScreen.swift` draws it as a SwiftUI `List` in a `NavigationStack`.

What it showed (iPhone 17 Pro simulator, iOS 26.4):

- The same view renders unchanged on the web and as a native screen on iOS: large title, grouped
  `List`, SF Symbols, content scrolling under a Liquid Glass tab bar.
- A row press is the web link's click: the router moves, and the unconverted channel page is pushed
  by the native stack, with the system's glass back button and interactive swipe-back.
- The long-press menu is the system's, built from the menu data the view already declares
  (`nativeContextMenu`): symbols, destructive items, submenu. A choice goes through Foldkit's
  `update` (it sent `channelMember.update`; the offline fixture has no answer for it).
- Unconverted parts show in place (org switcher, the create-channel hint): the gap is visible.

Lessons:

- The web view must stay in the window: WebKit stops animation frames for a view outside it, and
  Foldkit renders on them, so the whole app froze. The shell parks it behind the native screen.
- `display: contents` wrappers read as invisible to `checkVisibility()`; the reader allows them.
- Containers (`screen`, `section`) and leaves (`item`, `action`) differ: inside a leaf only nested
  nodes count; inside a container, un-annotated text is unconverted.
- The DOM is the spike's transport, not the real one: phase 1 takes the tree from `RenderTarget`
  (no DOM, keyed diffs instead of the whole screen as JSON on every change).

### Round 2: the web's look, natively

Stock SwiftUI styling made the native screen look like a different app. The renderer now takes its
look from the page (`apps/ios-hybrid/web/look.ts`): for each node, the computed colours (any CSS
colour, resolved to sRGB), font size, weight and tracking, the row's box, radius and border, where
its icon, label, badge and trailing glyph sit, the pressed wash, and the band a pinned header or
footer sits in. Native views draw with those values in Inter (the web's own `@fontsource` files,
converted to TTF). The header, footer, hint and section menus were annotated too, so the whole
channel list comes from the view: org switcher and account are native pull-down menus built from
their menus' native data.

Result: the native list matches the web's (theme, type, spacing, badges, avatars), while scrolling,
presses, menus and navigation are native.

The open decision this raises, for phase 1:

- **A. The web stays the style engine.** A hidden web renderer lays out and styles every screen; the
  native renderer reads looks from it (as this spike). Pixel parity from one source (CSS) and a thin
  native renderer, at the cost of a WebKit instance and a bridge hop on every change.
- **B. Styles as data.** Each primitive's variants become data (tokens and `tailwind-variants`
  values) that both the web classes and the native renderers read; no DOM. Leaner and closer to the
  plan's `RenderTarget` design, but each primitive's look is specified once more as data, and
  parity has to be tested rather than read.

### Round 3: the web's icons, avatars and fixes found on the way

- Icons are the page's own SVGs (duotone, `currentColor`), rasterized by the page at 3x in their
  resolved colour, sent once by content hash and drawn natively (`look.ts` `iconKey`). Dithered
  avatars are rebuilt natively from their parts: background colour, the rasterized pattern, the
  initial in Inter. SF Symbols stay only as a fallback until a raster arrives.
- Composer (a web bug, also in iOS Safari): the placeholder was a non-editable widget inside the
  empty paragraph, and iOS WebKit inserts no text there, so typing did nothing. It now sits before
  the paragraph (`editor/plugins.ts`, `overlay/command-palette/search-editor.ts`).
- Keyboard: the web view shrinks above the keyboard and the page never scrolls as a whole, so the
  page's own layout handles it (header stays, composer on the keyboard); no form accessory bar.
- Pushed pages keep the web's header as the bar, with the system's swipe back re-enabled (UIKit
  turns both pop gestures off with a hidden bar).
- Launch: the first native frame waits until the page settled (fonts, icons, no change for 250 ms),
  so the screen appears whole instead of filling in and jumping.

### Round 4: the chat screen natively (performance bar: 120 fps, no dropped frames)

- **Measuring**: a 3,000-message #engineering in the offline fixture (`web/big-channel.ts`) and an
  in-app frame monitor (`FrameMonitor.swift`: every frame at up to 120 Hz, dropped frames, main-thread
  time per bridge message).
- **Message list** (`web/list-capture.ts`, `NativeList.swift`): the web lays out each row; the bridge
  captures it once as a display list (text runs per line from the page's own text layout, boxes,
  icons, tap regions, its long-press menu) and again only when a mutation touches it. Native draws
  each row into a bitmap on a background queue; scrolling moves layers only. Inverted layout (older
  rows extend the far end), anchoring by key through window changes, steering of the hidden web list
  (render around the native viewport, its top for older pages, its end to follow new messages).
- **Composer** (`web/composer-capture.ts`, `NativeComposer.swift`): a native text field and keyboard
  in the web composer's look. The draft goes into the web editor through its own transactions
  (`replaceDraft`, never focusing it: a focused web field starts WebKit's text input on the shell's
  main thread), and Send presses the web's send once the composer reports the draft. The web view
  never resizes for this keyboard.
- **Measured (simulator, 60 Hz)**: zero dropped frames scrolling 20 flings through history (window
  32 → 122), typing, sending, opening the keyboard after the first time. Open: 8 dropped frames on
  the process's first keyboard (iOS loading it), 1 on opening a channel; real-device 120 Hz pending.
