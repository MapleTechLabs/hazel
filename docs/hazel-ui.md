# Hazel UI: one vocabulary, native renderers

Status: draft v1 (2026-11-26). Builds on `docs/cross-platform-ui.md` and changes two of its
decisions (see "What changes from cross-platform-ui.md"). Spike: branch `t3/effect-ui-native-spike`,
`apps/ios-hybrid/effect-ui/` and `apps/ios-hybrid/EffectUiSpike/`.

## Summary

Shared screens are written once, as Effect UI components in our own element vocabulary (`hazel`):
about 25 typed primitives such as `section`, `item`, `list`, `textField` and `sheet`. Two hosts draw that
vocabulary: on the web it becomes DOM styled with our CSS, on iOS it becomes SwiftUI views,
with no web view. Styles are data: one `tokens.ts` file of tokens and per-primitive recipes, which
codegen turns into CSS for the web and `Theme.swift` for iOS. Model, update, Commands, queries and
the data layer are shared. Each platform owns only its renderers, its look's output and a few
platform services. A part only one platform draws, such as a shader, is a platform
extension: declared once with typed props, drawn where it is implemented, skipped elsewhere.

## What the spike showed

The channel list ran as an Effect UI component in a bare JavaScriptCore context, on a custom
`Renderer.Host` with no DOM, and SwiftUI drew it in Hazel's look (iPhone 17 Pro simulator):

| | |
| --- | --- |
| Script evaluated and mounted | 26 ms |
| First screen | 111 ops |
| A press, or a new message on a row | 1 op, about 110 bytes |
| Swift applying a batch | 0.1 to 0.4 ms |
| Bundle (minified, with the fixture and `@hazel/domain`) | 242 KB, 82 KB gzipped |
| Globals JavaScriptCore lacked | `TextEncoder`, `TextDecoder`, `queueMicrotask`, timers, `console` |

The app links JavaScriptCore and SwiftUI, not WebKit. Facts the plan relies on:

- `Renderer.Host<Node>` is public, and so is defining a vocabulary: `@effect/ui-opentui` builds its
  own from the public subpaths `@effect/ui/View`, `Renderer`, `Component` and `Mount`.
- A host declares the vocabularies it draws (`Host.elements`). A child component of a vocabulary
  the host does not list fails as that child, with its fallback, and the rest keeps running.
- Effect UI renders per component: a message re-runs only its component's view, so a native host
  receives keyed, minimal changes, not screens.

## Goals

1. One implementation of each shared screen's state, logic and structure, for web and iOS.
2. iOS screens fully native: SwiftUI drawing, system scrolling, menus, sheets and gestures. Scrolling,
   typing and animation never wait on JavaScript.
3. Parity enforced by types: a shared screen cannot use something one platform cannot draw.
4. One source for the look, so web and iOS cannot drift.
5. Incremental: the Foldkit web app keeps shipping while screens move one at a time.

Non-goals for now: Android (the native host and wire are platform-neutral, so a Compose renderer
can come later), macOS (phase 4 of `cross-platform-ui.md`, through the same SwiftUI renderer), and
moving web-only screens (settings, admin) off `Html`.

## Decisions

1. **Effect UI is the framework for shared screens.** It is Foldkit's successor (Foldkit's feature
   work is paused), and its host seam is what `cross-platform-ui.md` planned to build as a Foldkit
   `RenderTarget` in a fork.
2. **Shared screens use the `hazel` vocabulary, not annotated `Html`.** A screen in `hazel` can only
   use primitives every host implements, so an unconverted part is a type error, not a silent gap.
3. **Platform-specific parts are declared, not leaked.** A part only one platform draws (a Metal
   shader, a native map, a web canvas, a web-only settings panel) is a platform extension: declared
   once with typed props and events and the platforms that implement it, drawn where it is
   implemented and skipped (or replaced by its fallback) elsewhere. Skipping it is intended, so it is
   not counted as a gap. A part that should exist everywhere but has no renderer yet is a different
   thing: it fails the type check. See "Platform extensions".
4. **The design language lives in the primitives.** A primitive with no props already looks right:
   its spacing, type, colour, radius, height, icon size, press and focus states, and motion are
   decided by its recipe. A view says what something is and what state it is in (`item.selected()`,
   `text.role("caption")`, `button.variant("danger")`), never how it looks. The few choices a view has
   are small closed sets of named options, not values. Styles are data: `tokens.ts` holds tokens and
   recipes, and codegen writes the CSS and `Theme.swift`. See "Design language".
5. **Primitives are semantic and platform-shaped.** `menu` is a popover on the web and `UIMenu` on
   iOS; `tabBar` is the rail on wide web and the system tab bar on iOS. A view never asks which
   platform it is on.
6. **One wire for native hosts.** The native host sends typed, batched ops per flush (below). Swift
   keeps the tree and draws it. Events come back by node id.
7. **JavaScript runs off the main thread on iOS.** One dedicated JavaScriptCore thread; the main
   thread only applies op batches and draws. Native owns hot paths: lists get row data with stable
   keys, text fields own their text while editing (revisioned echoes), swipe-back completes natively.
8. **Converted screens ship as islands inside the Foldkit app** until the web app has moved to
   Effect UI. An island mounts the screen's Effect UI component in a container the Foldkit view owns,
   over the same data services instance.

### What changes from cross-platform-ui.md

- Its decision 1 ("annotate the HTML, don't replace it") becomes decision 2 here: shared screens are
  written in `hazel`. Annotation kept the web safe from regressions; here the web host's conformance
  tests and screenshot diffs do that job.
- Its decision 4 (`packages/foldkit-native` on a Foldkit `RenderTarget`) becomes Effect UI's
  `Renderer.Host`, with no fork.
- Its open question A vs B (web as style engine, or styles as data) is settled as B.

## Architecture

```text
            shared (TypeScript, Effect UI)
  screens (hazel vocabulary) ── queries, Commands ── @hazel/domain, data layer
                     │
        ┌────────────┴────────────┐
   web host (DOM)            native host (no DOM)
   packages/ui/src/web       packages/ui/src/native ── ops ──▶ Swift: HazelUI package
   generated tokens.css                                        op applier, primitive views,
                                                               generated Theme.swift
```

### Packages

| Path | Holds |
| --- | --- |
| `packages/ui` (`@hazel/ui`) | the `hazel` vocabulary (`src/vocabulary/`), tokens and recipes (`src/style/tokens.ts`), codegen (`scripts/`), the web host (`src/web/`), the native host and wire (`src/native/`), conformance fixtures (`src/conformance/`) |
| `apps/ios-hybrid/HazelUI/` | Swift package: wire decoding, the tree, one view per primitive, generated `Theme.swift`, the JavaScriptCore runtime and its platform services |
| `apps/web-foldkit/src/islands/` | mounting a shared screen inside the Foldkit app, and the Layer that hands it the app's data services |
| `apps/shared-screens/` (name to settle) | the shared screens themselves, with their queries and Commands |

## The vocabulary

v1 is the `cross-platform-ui.md` list. Each tag is a typed builder with chainable props, as
`OpenTui`'s are. Text lives only in text primitives (`textParents`).

| Group | Tags |
| --- | --- |
| Layout | `stack` (axis, density, align), `spacer`, `scroll`, `frame` (surface), `divider` |
| Collections | `list` (keyed rows, sections, reach start or end, stick to bottom) |
| Content | `text` (role, tone, numeric, truncate), `heading` (level), `icon` (a name from the icon set), `image`, `avatar`, `badge`, `richText` |
| Controls | `button` (variant, size), `link`, `textField`, `textArea`, `toggle`, `select`, `searchField`, `composer` |
| Overlays | `menu`, `contextMenu`, `sheet`, `dialog`, `popover`, `toast` |
| Structure | `screen` (title, toolbar, back), `navigation`, `tabBar`, `splitView`, `section`, `item` |

Example:

```ts
h.section.title("Projects").action(h.icon.name("plus"), Msg.PressedCreate()).children(
	h.item
		.key(channel.id)
		.title(channel.name)
		.leading(h.icon.name("hashtag"))
		.badge(unread)
		.emphasized(unread > 0)
		.selected(channel.id === model.selectedId)
		.on("press", Msg.PressedChannel({ id: channel.id })),
)
```

Rules:

- Props are content (text, icon names, children, counts) and named options from closed sets
  (variants, roles, tones, states), never CSS, classes, colours, sizes or spacing values.
- Events are semantic (`press`, `longPress`, `change`, `submit`, `reachEnd`, `dismiss`), with typed
  plain-data payloads. Each host maps them from its own input.
- A primitive lands only with its web renderer, its Swift renderer and its conformance fixtures.
- Adding a prop to an existing primitive beats adding a primitive.

### Platform extensions

For parts one platform draws and the other skips. An extension is declared once, in shared code:

```ts
// packages/ui/src/extensions/MeshBackground.ts
export const MeshBackground = Hazel.extension({
	name: "MeshBackground",
	props: Schema.Struct({ colors: Schema.Array(TokenColor), speed: Schema.Finite }),
	events: { Tapped: {} },
	platforms: ["ios"],
})

// in a shared view
h.extension(MeshBackground, { colors: ["brand.500", "brand.300"], speed: 0.4 })
	.on("Tapped", Msg.TappedBackground())
	.fallback(h.frame.tone("muted")) // optional: what platforms without it draw
```

Each platform registers its implementations by name:

- **iOS:** `HazelUI.register("MeshBackground") { props, send in MeshBackgroundView(props) }`. Codegen
  turns each declaration's props Schema into a decodable Swift struct, so the view gets typed props
  and `send(.tapped)`. Shaders, `MapKit`, `RealityKit`, anything SwiftUI can host.
- **Web:** `registerWebExtension(MeshBackground, (container, props, send) => ...)`, or an `Html`
  child component: a canvas, WebGL, a third-party widget, a web-only settings panel.

Rules:

- A platform not in `platforms` skips the extension silently: its host creates no node, or draws
  `fallback` when one is given. The view never checks the platform.
- A platform listed in `platforms` must register it: a startup check in each host, and a test that
  compares the generated manifest with what each platform registered, fail otherwise.
- Props are data (tokens, numbers, strings, ids), as for primitives; events come back typed.
- An extension implemented on every platform is a candidate primitive: promote it when a second
  screen wants it.
- Platform behaviour that is not drawing (haptics, share, clipboard) is a platform service, not an
  extension.

## Design language

Most styling is decided before a view is written. The goal is that two people building two screens
get the same result without talking, and that a screen cannot drift from the system by accident.

**What primitives decide, always:** type (font, size, weight, line height, tracking per role),
colour per state, heights, paddings and radii, icon sizes and their alignment with text, spacing
between a primitive's own parts, press, hover, focus and disabled states, selection, and motion
(durations and curves). A view cannot set any of these.

**What containers decide:** the rhythm between things. A `section` spaces its header and rows, a
`list` spaces its rows, a `screen` sets its margins and the gap between sections, a `stack` spaces
its children from its `density` (`compact`, `regular`, `relaxed`), not from a number. A view picks a
container, not a gap.

**What a view chooses:** what each thing is and its state, from small named sets:

| Choice | Options (v1, closed) |
| --- | --- |
| `text.role` | `body`, `label`, `caption`, `title`, `display`, `code` |
| `text.tone` | `default`, `muted`, `subtle`, `accent`, `danger`, `success` |
| `button.variant` | `primary`, `secondary`, `ghost`, `danger` |
| `button.size` | `regular`, `small` |
| `stack.density` | `compact`, `regular`, `relaxed` |
| `frame.surface` | `none`, `card`, `inset`, `muted`, `overlay` |
| states | `selected`, `emphasized`, `disabled`, `loading`, `destructive` |

The sets are typed unions, so anything else is a compile error.

**Rules that keep it consistent:**

- Defaults are the common case. A row, a section, a button or a field with no style props is correct.
  If most call sites pass the same option, that option becomes the default.
- New options are design decisions. Adding a role, tone, variant or density goes through the
  user's review, lands in `tokens.ts` with both renderers, and gets a gallery entry. Lanes and
  screen agents never add options to unblock themselves; they ask.
- No escape hatches in shared screens: no `style`, `className`, raw numbers or colours on primitives.
  What a screen cannot express is a missing option or primitive, raised as such. A platform
  extension may take tokens as props, never raw values.
- Composite patterns are primitives, not recipes repeated in screens. An `item` already lays out its
  leading icon or avatar, title, subtitle, badge and trailing accessory; screens fill slots.
- A gallery (web page and iOS screen, both from the conformance fixtures) shows every primitive in
  every option and state, light and dark. It is the reference for what the system can say.

## Style layer

`packages/ui/src/style/tokens.ts` is the only source of the look:

- **Tokens:** colours by role with light and dark values (`fg`, `fg.2`, `fg.3`, `bg`, `sidebar.primary`,
  `wash`...), the type scale (Inter sizes, weights, line heights), spacing, radii, durations.
- **Recipes:** per primitive and variant, which tokens apply. For example `item`: height 40, radius 8,
  label `fg.3` at rest, `fg` when emphasized, `sidebar.primaryFg` on `sidebar.primary` when selected,
  pressed `wash`.
- **Icons:** the set is the web's own (`web-foldkit/src/icons`). Codegen writes SVGs for the web and a
  template-image asset catalog for iOS (the spike's `scripts/export-icons.ts`).

Codegen (`bun run ui:generate`) writes `tokens.css` (custom properties and one rule set per primitive)
and `Theme.swift`. CI fails when the generated files are stale.

Seeding and parity: the first values come from `web-foldkit/src/core/styles/styles.css` and the
`tailwind-variants` styles in `src/core/components/ui/*.styles.ts`, checked against what the hybrid
shell measured from the live page (`web/look.ts`, both themes). A parity test renders each conformance
fixture with the web host and compares computed styles to the recipe.

## Hosts and the wire

### Web host (`packages/ui/src/web`)

Built on `BrowserHost.makeHost(document)`. A `hazel` element becomes the DOM structure its recipe
describes (an `item` is a link or button with leading, label and trailing slots), with
`data-hz="<tag>"` and variant attributes that the generated CSS targets. `html` elements pass through
to the browser host unchanged. Hover, focus rings, keyboard and ARIA belong to the web renderer of
each primitive.

### Native host (`packages/ui/src/native`)

Keeps the tree as plain nodes and sends one batch per flush:

| Op | Fields |
| --- | --- |
| `create` | id, tag |
| `props` | id, changed props as JSON (only what changed) |
| `text` | id, text |
| `insert` | parent id, id, before id or null |
| `remove` | id |
| `events` | id, event names it handles |

Batches carry a sequence number. Ids are numbers the host assigns; 0 is the root. The protocol is
versioned (`WIRE_VERSION`), and Swift refuses a version it does not know. Events come back as
`fire(id, event, payload, seq)`.

### Swift (`apps/ios-hybrid/HazelUI`)

- `Runtime`: one JavaScriptCore context on its own thread; timers, `console`, `TextEncoder`/`Decoder`,
  `queueMicrotask`, and the platform services below. Batches hop to the main actor.
- `Tree`: applies batches; observable per node, so a changed row redraws alone.
- `Primitives/`: one SwiftUI view per tag, reading `Theme`.
- Platform services the JavaScript side calls through Effect services, each with a web
  implementation and a Swift-backed one: `fetch` (URLSession), `WebSocket` (URLSessionWebSocketTask),
  storage for the local cache, auth (keychain), haptics, clipboard, share.

## Running inside the Foldkit app (islands)

Until the web app is on Effect UI, a converted screen is an island: the Foldkit view renders a
container element, and a Mount mounts the screen there with the web host. The island receives the
app's existing data services (collections, RPC client, session) as Layers built from the instances
the Foldkit app already holds, so there is one sync engine and one cache. Routing stays Foldkit's;
the island gets the route as props and asks for navigation through an event.

On iOS the same screen mounts on the native host, over the same data services running in
JavaScriptCore.

## Testing

- **Unit:** components on Effect UI's `TestHost` (plain objects), as today's scene tests do.
- **Conformance fixtures** (`packages/ui/src/conformance/`): per primitive, a set of trees with props
  and expected semantics. The web host renders them in the browser test runner (screenshots, ARIA,
  computed style against recipes). Swift renders them in snapshot tests. Both read the same JSON.
- **Wire:** golden op streams for mount, prop change, keyed reorder, removal; Swift decodes the same
  goldens.
- **Performance bar** (from `cross-platform-ui.md`): 120 fps with no dropped frames on the
  3,000-message channel on a device, typing included. `FrameMonitor` and op counts per interaction
  are logged in each screen's PR.
- **Every screen PR** carries web and iOS screenshots, light and dark.

## Phases and work packages

Phase 0 is serial and settles the gates. Phase 1 freezes the contracts. After that, lanes run in
parallel and touch only their own paths. A contract changes only through its owner's package.

### Phase 0: gates (before any lane starts)

| Gate | Question | Done when |
| --- | --- | --- |
| G1 | Can one web host draw `hazel` and `html` together, built on `BrowserHost.makeHost`, and do extensions skip cleanly? | a `hazel` component with an `Html` child and an iOS-only extension renders in the browser with the extension skipped; on the native host the extension draws a registered SwiftUI view and the web-only extension is skipped |
| G2 | Can an Effect UI island run inside the Foldkit app over its data services? | the spike's channel list mounts in `web-foldkit` from the real collections and updates live |
| G3 | Does the data layer run in JavaScriptCore with Swift-backed `fetch` and `WebSocket`? | the iOS spike shows live channels from a dev backend |
| G4 | JavaScriptCore on its own thread | presses and batches cross threads with no dropped frames while JS is busy for 50 ms |
| G5 | Controlled text through the wire | typing fast into a native `textField` bound to Model never loses or reorders characters (revisioned echoes) |
| G6 | Codegen round trip | `tokens.ts` for `item` and `section` generates CSS and Swift, and the web parity test passes against `styles.css` |

Gates are short spikes on the spike branch. A failed gate changes this document before lanes start.

### Phase 1: contracts (one agent, reviewed)

- **C1 Vocabulary API:** `packages/ui/src/vocabulary/`: every v1 tag's builder, props and events as
  types, plus `textParents`, and `Hazel.extension` with its manifest. Implemented only enough to
  type-check example screens.
- **C2 Wire:** `packages/ui/src/native/wire.ts` (op types, `WIRE_VERSION`) and its golden streams.
- **C3 Tokens schema:** `packages/ui/src/style/schema.ts`: the shape of tokens and recipes, and the
  codegen interfaces.

Exit: three example screens (channel list, DMs, a settings form) type-check against C1, reviewed by
the user.

### Phase 2: lanes (parallel)

| Lane | Owns | Depends on | Done when |
| --- | --- | --- | --- |
| A Web host | `packages/ui/src/web/` | C1, C3 | every v1 primitive renders, conformance fixtures pass in the browser runner; web extensions register and others skip or draw their fallback |
| B Native host and runtime (TS) | `packages/ui/src/native/` | C1, C2 | goldens pass, `fire` round trips, nodes free on removal; extensions cross the wire with typed props |
| C1 Swift: layout and content | `HazelUI/Primitives/{Layout,Content}/` | C2, C3 | fixtures for stack, scroll, frame, divider, text, heading, icon, image, avatar, badge pass snapshots |
| C2 Swift: controls | `HazelUI/Primitives/Controls/` | C2, C3, G5 | button, link, toggle, select, textField, textArea, searchField pass; text-input stress test passes |
| C3 Swift: overlays | `HazelUI/Primitives/Overlays/` | C2, C3 | menu, contextMenu, sheet, dialog, popover, toast use the system components |
| C4 Swift: structure and lists | `HazelUI/Primitives/{Structure,Collections}/`, `HazelUI/Tree.swift` | C2, C3 | screen, navigation (route and stack in sync), tabBar, splitView, section, item, list (keyed, sections, reach end, stick to bottom); the extension registry and its manifest check |
| D Tokens and codegen | `packages/ui/src/style/`, `packages/ui/scripts/` | C3 | every recipe filled from the seeds, generated files current, parity test green in both themes |
| E Conformance harness | `packages/ui/src/conformance/`, the browser runner, Swift snapshot target | C1, C2 | lanes A and C can add fixtures; CI runs both sides |
| F Platform services | `packages/ui/src/platform/`, `HazelUI/Runtime/` | G3, G4 | fetch, WebSocket, storage, auth, haptics, clipboard, share behind Effect services, web and Swift implementations |

### Phase 3: screens (parallel, one lane per screen)

In order of risk: channel list, DMs, activity, channel (message `list` with `richText`, attachments,
reactions, `contextMenu`), composer (shared draft state; ProseMirror on the web, a native text view on
iOS), threads, search. Each is a work package: the component in `hazel`, its island in `web-foldkit`,
web and iOS screenshots in both themes, performance numbers.

### Phase 4: the rest

Long-tail screens convert when touched. The Foldkit app moves to Effect UI when its upgrade guide
exists; islands then become ordinary children.

## Rules for implementing agents

- Read this document, `docs/cross-platform-ui.md` and `CLAUDE.md` first. Effect UI's own guide is
  `node_modules/@effect/ui/ai-docs/` and `LLMS.md`; read the installed source, not memory.
- Touch only your lane's paths. A contract change goes to its owner as a proposal, never in a lane.
- No raw colours, sizes or classes in views or Swift primitives: everything comes from `Theme`.
- Every primitive or screen PR: conformance fixtures, web and iOS screenshots (light and dark), and
  `bun run typecheck`, `bun run test:once` and the Swift tests passing.
- Effect UI is pinned to one pkg.pr.new commit across the repo; bumping it is its own PR.
- Its APIs are experimental: silence `experimentalApiUsage` per file with
  `// @effect-diagnostics experimentalApiUsage:off`, as the spike does.

## Risks

| Risk | Mitigation |
| --- | --- |
| Effect UI is a public preview and changes under us | one pinned commit, bumps as their own PRs, the vocabulary isolates screens from most of its API |
| Vocabulary bloat | props before primitives; a primitive lands only with both renderers and fixtures |
| Web regressions when screens move from Tailwind to recipes | parity tests against `styles.css`, screenshot diffs per screen PR |
| JavaScriptCore lacks a browser API the data layer needs | gate G3 before lanes; each gap becomes a platform service |
| Rich text and the composer are deep | their own work packages after the core loop; the hybrid app keeps working meanwhile |
| Bridge cost on large channels | row data with stable keys, native list virtualization, measured on device per screen |
| Two frameworks in the web app during the islands period | islands share data services, not state; the Foldkit app owns routing |

## Open questions for the user

1. The shared screens' home: `apps/shared-screens`, or a folder in `packages/ui`?
2. Do the hybrid app's web-view fallbacks stay for unconverted screens during the transition (as now),
   or does the new app ship only once the core loop is native?
3. Name of the vocabulary and package (`hazel`, `@hazel/ui`)?
