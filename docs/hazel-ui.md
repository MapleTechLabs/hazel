# Hazel UI: one vocabulary, native renderers

Status: draft v2 (2026-11-26), revised after two independent reviews (technical feasibility against
the Effect UI source, and swarm executability against the Hazel codebase). Builds on
`docs/cross-platform-ui.md` and changes three of its decisions (see "What changes from
cross-platform-ui.md"). Spike: branch `t3/effect-ui-native-spike`, `apps/ios-hybrid/effect-ui/` and
`apps/ios-hybrid/EffectUiSpike/`.

## Summary

Shared screens are written once, as Effect UI components in our own element vocabulary (`hazel`):
typed primitives such as `section`, `item`, `list`, `message`, `textField` and `sheet`. Two hosts draw
that vocabulary: on the web it becomes DOM styled with our CSS, on iOS it becomes SwiftUI views, with
no web view. The design language lives in the primitives: a view says what something is and what
state it is in, from small closed sets, and never how it looks. Styles are data: tokens and
per-primitive recipes, which codegen turns into CSS for the web and `Theme.swift` for iOS. Model,
update, Commands, queries and the data layer are shared. Each platform owns its renderers and a few
platform services. A part only one platform draws, such as a shader, is a platform extension:
declared once with typed props, drawn where it is implemented, a placeholder or fallback elsewhere.

## What the spike showed, and what it did not

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

Verified in the Effect UI source (installed commit `4d6d7ec`):

- A third party can define a vocabulary from public exports only. `@effect/ui-opentui` imports just
  `@effect/ui/{Component,Mount,Renderer,View,Command,Subscription}` and builds on `View.ElementBuilder`
  subclasses, `withFields`, `withNoTextContent`, `shorthand` and `Component.define`.
- `textParents` is enforced at runtime, and `h` accepts any tag value, so `h.extension(...)` is possible.
- Rendering is per component: a message re-runs only its component's view; a keyed move is an
  `insertBefore` of an existing node; `update` runs synchronously in `dispatch`; flushes are microtasks;
  `commit` runs once per flush.
- A child component whose vocabulary the host does not list fails as that child (its fallback), not
  silently: its `init` throws and is reported.
- One `effect` 4.1.5 instance serves both Foldkit and Effect UI.

What the spike did not prove, and the gates below must:

- **It sent annotated `Html` attributes, not a typed vocabulary.** A `hazel` vocabulary with JSON props
  has not crossed the bridge (G1).
- **It ran on the simulator, with JS on the main actor, fixture data, and `setProp` ignored.** Device
  performance, especially JavaScriptCore without JIT, is unmeasured (G4, G7).
- **Swift re-read the whole tree per batch.** Per-node observation is unproven (G8).

## Goals

1. One implementation of each shared screen's state, logic and structure, for web and iOS.
2. iOS screens fully native: SwiftUI drawing, system scrolling, menus, sheets and gestures. Scrolling,
   typing and animation never wait on JavaScript.
3. Parity enforced by types and lint: a shared screen cannot use something one platform cannot draw.
4. A consistent design language decided by the primitives, from one source, so screens and platforms
   cannot drift.
5. Incremental: the Foldkit web app keeps shipping while screens move one at a time.

Non-goals for now: Android (the wire is platform-neutral, so a Compose renderer can come later),
macOS (through the same SwiftUI renderer, later), and moving web-only screens (settings, admin) off
Foldkit or `Html`.

## Decisions

1. **Effect UI is the framework for shared screens.** It is Foldkit's successor (Foldkit's feature work
   is paused), and its public `Renderer.Host` is the seam `cross-platform-ui.md` planned to build as a
   Foldkit `RenderTarget` in a fork.
2. **Shared screens use the `hazel` vocabulary, not annotated `Html`.** Runtime tags are namespaced
   (`hz:item`, `hz:button`) so a host never confuses them with HTML or SVG names.
3. **Platform-specific parts are extensions, always with a node.** An extension is declared once with
   typed props, events and the platforms that implement it. Every host creates a placeholder node for
   it, so the renderer's bookkeeping holds. The implementing platform draws its registered view there;
   the others draw the extension's fallback child, or an empty placeholder. Web-only `Html` content is
   an extension whose web implementation mounts it, never an `Html` child component in a shared
   screen (that would fail on iOS).
4. **The design language lives in the primitives.** A primitive with no props already looks right.
   Views say what something is and its state, from closed sets of named options, never values. Styles
   are data; codegen writes CSS and Swift. See "Design language".
5. **Primitives are semantic and platform-shaped.** `menu` is a popover on the web and `UIMenu` on iOS.
   A view never asks which platform it is on.
6. **One wire for native hosts:** typed, versioned ops per flush, a command channel for imperative
   requests (focus, scroll, measure) with replies, and events back by node id.
7. **JavaScript runs off the main thread on iOS,** on one JavaScriptCore thread with an Effect
   scheduler that stays in JS. Native owns hot paths: lists virtualize natively, text fields own their
   text while editing (revisioned echoes), swipe-back completes natively.
8. **The data layer becomes a package** that runs on the web and in JavaScriptCore with injected
   platform services, before any shared screen needs live data.
9. **Converted screens ship as islands inside the Foldkit app** until the web app moves to Effect UI,
   over the same data package instances.

### What changes from cross-platform-ui.md

- "Annotate the HTML, don't replace it" becomes "shared screens are written in `hazel`". The web is
  protected by pixel diffs against today's kit (G6) and per-screen screenshot diffs instead.
- `packages/foldkit-native` on a Foldkit `RenderTarget` becomes Effect UI's `Renderer.Host`, no fork.
- Option A vs B (web as style engine, or styles as data) is settled as B. This gives up the old plan's
  trick for the message list (the web lays out rows, native draws bitmaps), so native rich-text rows
  at 120 fps are a gate of their own (G7).

## Architecture

```text
              shared (TypeScript, Effect UI)
  screens (hazel) ─ queries, Commands ─ @hazel/client-data ─ @hazel/domain
                         │
          ┌──────────────┴──────────────┐
   web host (DOM)                 native host (no DOM)
   @hazel/ui/web                  @hazel/ui/native ── ops, commands ──▶ Swift: HazelUI
   generated tokens.css                         ◀── events, replies ──  Tree, primitives,
                                                                        Theme.swift, Runtime
```

### Packages

| Path | Holds |
| --- | --- |
| `packages/ui` (`@hazel/ui`) | the vocabulary (`src/vocabulary/`), tokens (`src/style/tokens.ts`) and one recipe file per primitive (`src/style/recipes/<primitive>.ts`), codegen (`scripts/`), the web host (`src/web/`), the native host and wire (`src/native/`), conformance fixtures and the gallery (`src/conformance/`) |
| `packages/client-data` (`@hazel/client-data`) | collections, live queries, the sync client and RPC, moved out of `apps/web-foldkit/src/core/db` and `src/data`, with every browser API behind a platform service |
| `apps/ios-hybrid/HazelUI/` | Swift package: wire decoding, `Tree`, one view per primitive, generated `Theme.swift`, the JavaScriptCore runtime, platform services, the extension registry |
| `apps/web-foldkit/src/islands/` | mounting a shared screen inside the Foldkit app |
| shared screens (home to settle, see open questions) | the screens, with their queries and Commands |

Registries (primitive renderers, extensions, fixtures, recipes) discover their entries by file glob,
so adding one never edits a shared list.

## The vocabulary

Each tag is a typed builder with chainable props, as `OpenTui`'s are. Text lives only in text
primitives (`textParents`).

| Group | Tags |
| --- | --- |
| Layout | `stack` (axis, density, align), `spacer`, `scroll`, `frame` (surface), `divider` |
| Collections | `list` (keyed rows, sections, anchoring, reach start or end, stick to bottom), `listDivider` (kind: `date`, `unread`) |
| Content | `text` (role, tone, strong, numeric, truncate), `heading` (level), `icon`, `image`, `avatar` (presence), `avatarStack`, `badge` (tone, size), `richText` (paragraphs, mentions, links, code, code blocks, quotes) |
| Chat | `message` (states: `grouped`, `pinned`, `highlighted`, `entering`, `pending`, `failed`; slots: author, time, body, attachments, reactions, thread summary), `reactionBar`, `attachmentGrid`, `embed`, `typingIndicator` |
| Controls | `button` (variant, size, iconOnly), `link`, `textField`, `textArea`, `toggle`, `select`, `searchField`, `composer` |
| Overlays | `menu`, `contextMenu`, `sheet`, `dialog`, `popover`, `toast`, `tooltip` |
| Structure | `screen` (title, toolbar, back), `navigation`, `tabBar`, `splitView`, `section`, `item` |

The chat group exists because slot-based `item` cannot express a message row: today's row
(`chat/message/row.ts`) has a hover-only timestamp gutter, group spacing, a pinned border and tint, an
enter animation and focus rings; the sidebar has a thread elbow and avatar stacks
(`shell/channels-sidebar/items.ts`). These become primitives with states, not screen code.

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

### How the builders compile (constraints from the renderer)

The renderer creates an element from its tag alone, inserts its children, and only then sets its
props (`internal/kernel.ts`). Props are opaque values compared with `===`; only children render and
only handlers dispatch (`View.ts`). So:

- **Slots and actions are child elements.** `.leading(x)` appends a child `hz:slot` named `leading`
  holding `x`; `.action(icon, msg)` appends a child `hz:action` with the handler; `.fallback(x)` appends a
  `hz:slot` named `fallback`. Only plain data (strings, numbers, booleans, option names) are props.
- **A tag's structure is fixed when it is created.** A host builds the element's own nodes at create
  time with one content parent for its children; what props change later (link vs button, an icon) the
  host swaps inside the element's own nodes. `parentOf` and `nextOf` only ever see the element's outer
  node.
- **Array or object props are avoided** (they re-send every render); where unavoidable, the native host
  deep-compares before sending.

### Rules

- Props are content (text, icon names, counts) and named options from closed sets, never CSS,
  classes, colours, sizes or spacing values.
- Events are semantic (`press`, `longPress`, `change`, `submit`, `reachStart`, `reachEnd`, `dismiss`),
  with typed plain-data payloads. Each host maps them from its own input.
- Every builder inherits `attr`, `attrs`, `prop` and `h.el` from `View.ElementBuilder`. The vocabulary
  overrides them as `never` where the types allow, and a lint rule (`hazel/no-raw-escape`) bans them in
  shared screens. "Parity by types" means types plus this rule.
- A primitive lands only with its web renderer, its Swift renderer and its conformance fixtures.
- Adding a prop or state to an existing primitive beats adding a primitive.

### Platform extensions

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
	.fallback(h.frame.surface("muted")) // optional
```

- **iOS:** `HazelUI.register("MeshBackground") { props, send in MeshBackgroundView(props) }`. Codegen
  turns the props Schema into a decodable Swift struct. Shaders, MapKit, RealityKit, anything SwiftUI hosts.
- **Web:** `registerWebExtension(MeshBackground, (container, props, send) => ...)`: a canvas, WebGL, a
  third-party widget, or a mounted `Html` component for a web-only panel.
- Every host creates the extension's placeholder node. A host that implements it draws there and
  ignores the fallback slot; a host that does not draws the fallback slot, or nothing.
- A platform listed in `platforms` must register it: each host checks at startup, and a test compares
  the generated manifest with what each platform registered.
- Props are data; colours and sizes are token names, never raw values. Events come back typed.
- An extension implemented on every platform that a second screen wants is promoted to a primitive.
- Non-drawing platform behaviour (haptics, share, clipboard) is a platform service.

## Design language

Most styling is decided before a view is written: two people building two screens get the same
result without talking, and a screen cannot drift from the system by accident.

**What primitives decide, always:** type per role (font, size, weight, line height, tracking), colour
per state, heights, paddings and radii, icon sizes and alignment, spacing between a primitive's own
parts, press, hover, focus and disabled states, selection, and motion.

**What containers decide:** the rhythm. A `section` spaces its header and rows, a `list` its rows, a
`screen` its margins and sections, a `stack` its children from its `density`. A view picks a container,
not a gap.

**What the host decides:** the size class (`compact` on phones and narrow windows, `regular` on wide
ones), which replaces today's `sm:` and `max-md:` branches. Recipes may vary by size class; views never see it.

**What a view chooses:** what each thing is and its state, from closed sets. The v2 sets below were
widened after checking them against today's kit (`button.styles.ts`, `badge.styles.ts`, text sizes in
use); Phase 1 re-derives them from the message row, composer and sidebar before they freeze.

| Choice | Options (proposed, closed) |
| --- | --- |
| `text.role` | `body`, `label`, `caption`, `title`, `display`, `code` |
| `text.tone` | `default`, `muted`, `subtle`, `accent`, `success`, `warning`, `danger`, `info` |
| `text.strong` | on or off (the one weight choice a view has; an author name, an unread row) |
| `button.variant` | `primary`, `secondary`, `outline`, `ghost`, `warning`, `danger` |
| `button.size` | `regular`, `small`, `xsmall`; `iconOnly` makes it square |
| `badge.tone` | `neutral`, `accent`, `success`, `warning`, `danger`, `info` |
| `badge.size` | `regular`, `small` |
| `stack.density` | `compact`, `regular`, `relaxed` |
| `frame.surface` | `none`, `card`, `inset`, `muted`, `overlay` |
| states | `selected`, `emphasized`, `disabled`, `loading`, `destructive`, plus each primitive's own (`message.pinned`...) |

Rules:

- Defaults are the common case. If most call sites pass the same option, it becomes the default.
- New options are design decisions: the user reviews them; they land in the recipes with both
  renderers and a gallery entry.
- When an agent needs an option that does not exist, it uses the nearest one, marks the call with
  `// HAZEL-GAP(<id>): <what is needed>`, and appends the gap to `packages/ui/GAPS.md`. It never waits
  and never invents an option. The user resolves the ledger.
- No escape hatches in shared screens: no `style`, classes, raw numbers or colours.
- Composite patterns are primitives, filled through slots.
- The gallery (web page and iOS screen, generated from the conformance fixtures) shows every primitive
  in every option and state, in both themes and size classes. It is the reference for what the system
  can say.

## Style layer

- **Tokens** (`src/style/tokens.ts`): colours by role with light and dark values, the type scale,
  spacing, radii, durations and curves.
- **Recipes** (`src/style/recipes/<primitive>.ts`, one file per primitive, owned with the primitive):
  per variant, state and size class, which tokens apply.
- **Supported CSS features** (fixed in C3): what a recipe can express, so lane D does not discover gaps
  late. Today's kit uses `color-mix`, pseudo-element hit areas, `forced-colors`, child-slot selectors
  and breakpoints; each is either a recipe feature or moved into the web renderer of that primitive.
- **Icons:** the web's own set (`web-foldkit/src/icons`), exported as SVGs for the web and a template
  asset catalog for iOS (the spike's `scripts/export-icons.ts`).

Codegen (`bun run --cwd packages/ui ui:generate`) writes `tokens.css` and `Theme.swift`; CI fails when
they are stale. Only the integrator commits regenerated files.

**Parity is against today's kit, not against the recipes.** Seeds come from `styles.css`, the
`*.styles.ts` files and what the hybrid shell measured on the live page (`web/look.ts`). The gallery
renders each `hazel` primitive beside the existing Foldkit component with the same content, and a
pixel diff with a stated tolerance must pass in both themes. Comparing rendered CSS with the recipe
that produced it would prove nothing.

## Hosts and the wire

### Web host (`@hazel/ui/web`)

- Wraps the host from `BrowserHost.layer()`, which keeps `Html.Host` and the document services
  (visibility, connectivity, global events, animation frames, media queries). `hz:*` tags get the
  structure their renderer builds (with `data-hz` and option attributes the generated CSS targets);
  any other tag passes through to the browser host.
- A `hazel` root cannot use `BrowserHost.mount` (it requires an `Html` root), so it mounts with
  `Renderer.mount`. That loses `BrowserHost`'s default `HtmlScheduler`, hot reload, devtools pause and
  paint, and hydration. The web host provides the scheduler itself; hot reload and devtools are
  accepted losses until upstream supports custom roots (raise it with Effect UI).
- Islands mount with `head: false`; the Foldkit app owns the document head.
- Hover, focus rings, keyboard and ARIA belong to each primitive's web renderer.

### Native host (`@hazel/ui/native`) and the wire

One batch per flush, with a sequence number; ids are numbers the host assigns, 0 is the root:

| Op | Fields |
| --- | --- |
| `create` | id, tag |
| `props` | id, changed props as JSON (deduped by value; controlled props carry a revision) |
| `text` | id, text |
| `insert` | parent id, id, before id or null |
| `remove` | id |
| `events` | id, event names it handles |
| `detach` | id (a kept-alive subtree held outside the tree, from `createContainer`) |
| `command` | request id, node id, name (`focus`, `blur`, `scrollTo`, `measure`, `select`), args |

Swift sends back `fire(id, event, payload, seq)` and `reply(requestId, result)`. Commands reach the
host through `Renderer.Refs` and the vocabulary's `Host` service, as `OpenTui` does; the spike stubbed
them. The protocol is versioned (`WIRE_VERSION`), and Swift refuses an unknown version.

- **Controlled props** are re-sent by the renderer on every patch. The host drops repeats, and for
  text it stamps a revision; Swift applies a value only once it has caught up with its own edits.
- **Ops outside a flush** (a failure's fallback placed between flushes) are sent by the host on its own
  next microtask rather than waiting for the next `commit`.

### Swift (`HazelUI`)

- `Runtime`: one JavaScriptCore context on its own thread; timers, `console`, `TextEncoder`/`Decoder`,
  `queueMicrotask`; an Effect `Scheduler` that runs in JS rather than hopping through `setTimeout(0)` into
  Swift. Batches hop to the main actor. Native never needs a synchronous answer from JS.
- `Tree`: applies batches, keeps detached subtrees, and is observable per node, so a changed row redraws
  alone.
- `Primitives/`: one SwiftUI view per tag, reading `Theme`.
- `Extensions/`: the registry and the manifest check.

### Platform services

Each is an Effect service with a web implementation and a Swift-backed one. The list comes from what
`apps/web-foldkit/src/core/db`, `src/data` and `libs/effect-db-collection` actually use:

`fetch` with `Headers`, `Request`, `Response`, `URL`, `AbortController` and streams (URLSession);
`WebSocket` (URLSessionWebSocketTask); `crypto.randomUUID`; `localStorage` (a key-value store);
`setInterval`; the local cache's SQLite (`LocalCacheHost`, wa-sqlite on the web, SQLite on iOS); online
and visibility signals; auth and session (keychain, and the cookie-session sign-in the web uses);
haptics, clipboard, share. G3 confirms the list is complete.

## Running inside the Foldkit app (islands)

A converted screen is an island: the Foldkit view renders a container, and an `OnMount` mounts the
screen there with the web host (Foldkit leaves the container's children alone; G2 confirms). The
island gets `@hazel/client-data`'s instances, the same ones the Foldkit app uses, as Layers. Routing
stays Foldkit's: the island gets the route as props and requests navigation through an event.
Focus and keyboard handoff, overlay stacking against the app's popover and tooltip hosts, global
keybindings, theme switching, and Tailwind's preflight against `data-hz` CSS are all part of G2.

## Testing

- **Unit:** components on Effect UI's `TestHost`.
- **Conformance fixtures** (`packages/ui/src/conformance/<primitive>/*.json`, schema fixed in phase 1.5):
  trees with props and expected semantics. The web renders them in the browser runner (screenshots,
  ARIA, pixel diff against today's kit); Swift renders them in snapshot tests on a pinned simulator.
- **Wire goldens:** op streams for mount, prop change, keyed reorder, removal, detach, commands; Swift
  decodes the same files.
- **Performance bar:** 120 fps with no dropped frames on the 3,000-message channel, on a device, typing
  included. Each screen PR logs `FrameMonitor` numbers and op counts per interaction.
- **Every screen PR** carries web and iOS screenshots from the gallery harness, light and dark.

## Phases and work packages

Serial until the risky parts are proven and the shared scaffolding exists; parallel after.

### Phase 0: gates

Short spikes on the spike branch, in this order. A failed gate changes this document before anything
else starts.

| Gate | Question | Done when |
| --- | --- | --- |
| G1 | Does a typed `hazel` vocabulary work on both hosts? | `hz:` tags with slot children, a link-vs-button prop swap, an iOS-only extension and a web-only extension: the browser draws the web parts and the placeholder, iOS draws the native parts and the fallback, both from one component; JSON props cross the wire |
| G6 | Codegen and parity | recipes for `item`, `section` and `button` generate CSS and Swift; the gallery pixel-diffs the `hazel` versions against today's Foldkit components in both themes within tolerance |
| G4 | JavaScriptCore on its own thread, on a device | measured JS cost without JIT for mount and update of the channel list; presses and batches cross threads with no dropped frames while JS is busy for 50 ms; the JS-side scheduler is in place |
| G8 | Per-node observation in Swift | changing one row's prop redraws only that row (Instruments or a render counter), on a 500-row tree |
| G7 | Native message list | 3,000 messages with `richText`, reactions and attachments in a native `list`: prepend older pages with anchoring, stick to bottom, 120 fps flings on a device; settles who windows rows (JS or native) and what a row costs on the wire |
| G5 | Controlled text through the wire | typing fast into a native `textField` bound to Model never loses or reorders characters, with the revision scheme above |
| D0 | Data package extraction (not a gate, a prerequisite for G2 and G3) | `@hazel/client-data` holds collections, live queries and sync with platform services injected; `web-foldkit` uses it unchanged in behaviour |
| G2 | An island inside the Foldkit app | the channel list mounts in `web-foldkit` over `@hazel/client-data`, updates live, and passes the island checks above |
| G3 | Data layer in JavaScriptCore | the iOS app shows live channels from a dev backend through the Swift-backed services; no browser API left unprovided |

### Phase 1: contracts (one agent, user-reviewed)

- **C0 Scaffold:** `packages/ui` and `packages/client-data` packages, the `HazelUI` Swift package and its
  `project.yml` entries, glob registries, stub generated files, every dependency installed once. After
  C0 no lane touches `bun.lock`, the root `package.json`, `project.yml`, CI files, generated files or
  lint baselines; the integrator does.
- **C1 Vocabulary API:** every tag's builder, props, slots, events, states and options as types,
  `Hazel.extension`, the `never` overrides and the `hazel/no-raw-escape` lint rule.
- **C2 Wire:** op, command and reply types, `WIRE_VERSION`, golden streams.
- **C3 Style schema:** tokens and recipe shapes, the supported CSS features, codegen interfaces.

Exit: the message row, the composer, the channel sidebar and a settings form type-check against C1
using only defaults, the closed sets and `HAZEL-GAP` markers; the user has reviewed the sets and the
gap list. What the screens needed changes the sets now, not during the lanes.

### Phase 1.5: harness (one agent, serial)

- **E Conformance harness and gallery:** the fixture JSON schema; the browser runner in CI; a macOS CI
  job with the exact `xcodebuild test` command, a pinned simulator, snapshot storage and tolerance; the
  gallery on both platforms; one command per lane to verify its work. After E, every "done when" below
  names a command that passes or fails without the user.

### Phase 2: lanes (parallel)

Each lane owns only the paths listed and verifies with its own command, never the whole suite.

| Lane | Owns | Done when |
| --- | --- | --- |
| A1 Web: layout and content | `src/web/primitives/{layout,content}/` | fixtures pass in the browser runner, pixel diffs within tolerance |
| A2 Web: controls | `src/web/primitives/controls/` | same, plus keyboard and ARIA checks per control |
| A3 Web: overlays and focus | `src/web/primitives/overlays/`, `src/web/focus/` | same, plus focus trapping and return, stacking with the Foldkit app's hosts |
| A4 Web: structure and list | `src/web/primitives/{structure,list}/` | same, plus list virtualization and anchoring |
| A5 Web: chat primitives | `src/web/primitives/chat/` | same, against today's message row in the gallery |
| B Native host (TS) | `src/native/` | goldens pass, commands and replies round trip, nodes freed on removal, extensions cross with typed props |
| S0 Swift: Tree and registry (first, then the rest start) | `HazelUI/Tree/`, `HazelUI/Extensions/` | goldens decode and apply, per-node observation holds (G8), manifest check works |
| S1 Swift: layout and content | `HazelUI/Primitives/{Layout,Content}/` | snapshot fixtures pass |
| S2 Swift: controls | `HazelUI/Primitives/Controls/` | snapshots pass, text-input stress test passes |
| S3 Swift: overlays | `HazelUI/Primitives/Overlays/` | system components, snapshots pass |
| S4 Swift: navigation and structure | `HazelUI/Primitives/Structure/` | route and `NavigationStack` stay in sync both ways, tab bar, split view |
| S5 Swift: list and chat primitives | `HazelUI/Primitives/{Collections,Chat}/` | G7's numbers hold with the real primitives |
| D Tokens and recipes | `src/style/tokens.ts`, `scripts/` | every token and option filled from the seeds, generated files current; recipe files are written by the primitive's lanes, D reviews them |
| F Platform services | `packages/client-data/src/platform/`, `HazelUI/Runtime/` | every service in the list, web and Swift implementations, G3 still passes |

### Phase 3: screens (one lane each)

In order of risk: channel list, DMs, activity, channel (message list), composer (split into three
packages: shared draft state, the web editor on ProseMirror, the native text view), threads, search.
Each: the component in `hazel`, its island, gallery screenshots on both platforms in both themes,
performance numbers.

### Phase 4: the rest

Long-tail screens convert when touched. When Effect UI publishes its Foldkit upgrade guide, the web
app moves to it and islands become ordinary children.

## Rules for implementing agents

- Read this document, `docs/cross-platform-ui.md`, `CLAUDE.md` and `AGENTS.md` first. Effect UI's guide
  is `node_modules/@effect/ui/ai-docs/` and its `LLMS.md`; read the installed source, not memory.
- Touch only your lane's paths. Never edit `bun.lock`, the root `package.json`, `project.yml`, CI files,
  generated files or lint baselines, and never run `ui:generate` or the formatter repo-wide.
- No new dependencies; ask the integrator.
- A contract change is a proposal to the contract owner, never made in a lane. The user reviews
  contract proposals; lanes keep working with a `HAZEL-GAP` marker meanwhile.
- No raw colours, sizes or classes in views or Swift primitives: everything comes from `Theme` and
  recipes. Missing options follow the `HAZEL-GAP` rule.
- Verify with your lane's command from phase 1.5, plus `bun run typecheck` for the packages you touched.
- One PR per lane, based on the contracts branch, rebased before review. Screenshots come from the
  gallery harness, not ad hoc.
- Effect UI is pinned to one pkg.pr.new commit across the repo; bumping it is its own PR.
- Silence `experimentalApiUsage` per file with `// @effect-diagnostics experimentalApiUsage:off`.
- Follow `CLAUDE.md`'s Effect rules and the knip and oxlint gates.

## Risks

| Risk | Mitigation |
| --- | --- |
| Effect UI is a public preview and changes under us | one pinned commit, bumps as their own PRs; the vocabulary isolates screens from most of its API |
| JavaScriptCore without JIT is too slow on a device | G4 on a device before contracts; keep JS work per interaction small (per-component renders, deduped props); native owns scrolling and typing |
| Native rich-text list misses the frame budget | G7 before contracts; if it fails, keep the hybrid's web-laid-out list for messages and revisit |
| Web regressions moving from Tailwind to recipes | pixel diffs against today's kit per primitive and per screen |
| The closed sets do not fit real screens | sets derived from the hardest screens in phase 1; `HAZEL-GAP` ledger instead of ad hoc styling |
| Vocabulary bloat | props and states before primitives; a primitive lands only with both renderers and fixtures |
| Lanes collide on shared files | C0 scaffold, glob registries, per-primitive recipe files, an integrator for shared files |
| Two frameworks in the web app during islands | islands share the data package, not state; Foldkit owns routing and the head |
| Lost hot reload and devtools for `hazel` roots | accepted for now; raise custom-root support upstream |

## Open questions for the user

1. Where shared screens live: `apps/shared-screens`, or a folder in `packages/ui`?
2. During the transition, does the iOS app keep the web-view fallback for unconverted screens (as the
   hybrid does now), or ship only once the core loop is native?
3. Names: `hazel` (runtime tags `hz:*`), `@hazel/ui`, `@hazel/client-data`?
4. A governed composite valve: should screens be allowed `h.custom("Name")` composites built only from
   primitives and tokens, registered in one file with a gallery entry, capped in number by a lint
   count only you raise? It keeps consistency (no raw styling) while letting a one-off layout ship
   without a new primitive. Without it, every such case is a `HAZEL-GAP`.
5. The proposed option sets in "Design language": in particular `text.strong` as the only weight choice,
   and `outline` and `warning` buttons.
