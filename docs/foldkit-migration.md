# Foldkit migration plan

Status: draft · Branch: `experiment-2.0` · Last updated: 2026-10-09

Goal: replace the React frontend (`apps/web`) with a Foldkit frontend (`apps/web-foldkit`) that looks pixel-identical to it. Users should notice nothing except speed and stability. Engineers should get a single Model, Messages as facts, and side effects that are testable.

The acceptance test is `packages/ui-parity` (see its README). A screen counts as ported when every one of its parity scenarios reports `identical`.

---

## Status (2026-10-08)

Every legacy route is ported. Since 2026-10-07 the last unported pieces landed: the chat-sync add-connection and link-channel modals, the set-status emoji and expiry pickers, the current-user status in the shell, link previews, tweets, YouTube, GIFs, the embla carousel and the Rivet AI token stream (each with fixture-served network data in the harness).

Certification runs (foldkit vs pin `639aa8d26`, `--strict-a11y`, port base 8000):

| Run | Tree | Variants | Identical | Pass | Fail | Behavior diffs | Passes with perceptual px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| burndown-3 | 4b3d8b2a0 | 707 | 535 | 146 | 26 | 0 | 0 |
| burndown-4 | 1b35c0235 | 758 | 563 | 175 | 20 | 0 | 0 |
| burndown-5 | f8a0391a4 | 758 | 558 | 193 | 7 | 0 | 0 |
| burndown-6 | 272eb5530 (main) | 758 | 565 | 186 | 7 | 0 | 0 |
| burndown-7 | 2607d8535 (main) | 758 | 576 | 175 | 7 | 0 | 0 |

burndown-7 (main, after the Foldkit 0.167 upgrade, the perf fixes, the review fixes in `docs/foldkit-review/`, typed route builders, the single toast helper and the Foldkit oxlint plugin) is the current certification result, same as burndown-5: the only failures are the 7 accepted legacy quirks below, every pass has 0 perceptual px and no structural deltas, and there are 0 behavioral differences. burndown-3's failures were fixed on `fk/kit-a11y-final`, burndown-4's on `fk/cert-fixes`.

Accepted legacy quirks (not imitated):
- `gallery-table-cell-keys` (2): React Aria's click announcement races the arrow-key announcements, so legacy's order varies per run; Foldkit's is the intended one.
- `chat-rich-channel` mobile, `chat-heavy-channel`, `chat-heavy-small-channel` (5): legacy measures rows before content loads, so its ARIA tree differs at capture time.
- `settings-chat-sync-add-connection-exists` and `-link-channel-exists` (pass at 0 px, outline delta in some runs): legacy refocuses the modal button after a failed submit only when the reply beats one animation frame (4 of 9 runs); Foldkit always refocuses.

onboarding-timezone keeps about 31k strict, 0 perceptual px from compositor layering of Foldkit's star animation.

Not ported: video playback (left for manual QA by decision on 2026-10-08; a fixture video would change the legacy `chat-attachments` capture), agent steps in AI replies (no fixture data), GitHub PR and Linear URL embeds, Tauri-specific blocks. Phase 6 (platform polish) and the manual QA checklist (§5 last item) remain.

### Performance (2026-10-08, `src/bench/perf.ts`, 5 runs, p50 / p95 ms)

Budgets: 120fps scrolling (main-thread work per frame under 8.33ms), warm channel switch under 50ms, cold under 100ms, everything else no slower than legacy. Foldkit 0.167; VirtualList was evaluated and rejected (`foldkit-decisions/s4b-virtual-list.md`).

| Metric | Legacy | Foldkit | Met |
| --- | --- | --- | --- |
| 10k channel wheel scroll, frame work | 1.1 / 181-254 | 1-1.8 / 12.6-22 | no (row batch inserts) |
| 10k channel fling to top | 0.3 / 1.3 | 1.7 / 33.7 | no |
| #general scroll, medium/fast | up to 181 p95 | 0.4-2.8 p95 | yes |
| Sidebar, 500 channels | 5.4 p95 | 3.3 p95 | yes |
| Switch heavy workspace, cold / warm | 936 / 444 | 150 / 145 | no (no warm reuse) |
| Switch normal workspace, cold / warm | 665 / 58 | 62 / 47.7 | cold yes, warm has 1-2 blank frames |
| Load heavy, ready to use | 1846 | 980 | yes |
| Composer key to paint | 1.6 / 50.7 | 2.5 / 35 | yes |
| Thread panel / palette / image viewer | 120 / 57 / 33 | 42 / 55 / 33 | yes |
| Delete modal / emoji picker, commit frame | 22 / 19-23 | 22-24 / 25 | delete yes, emoji within 3ms (input probe row: 37-39 / 39-41, one frame late) |
| JS heap after 20 switches (MB) | 254 | 65 | yes |
| JS bundle gzip (KB) | 1536 | 987 | yes |

Next: incremental row batches in `mount/message-list.ts`, a per-channel message window cache plus less sidebar re-patching for warm switches.

Overlay opens: Foldkit patches in its `requestAnimationFrame` callback, which runs after the probe's own callback in the same frame, so the input probe sees the overlay one frame after it painted. The bench now also reports a "commit frame" row (readiness also checked after each frame's paint). Modals, the palette and the emoji/GIF picker popover apply `inert` one frame after they paint (restyling the ~2,200 element app root cost 8-10ms inside the opening frame); overlays without a hit-testable underlay keep it synchronous so the hover leave still fires. What remains is the wait for the next frame after the click (about 14ms of the emoji picker's 25).

## 1. Starting point

**Legacy app** (`apps/web`, inventoried 2026-10-07):

|                         |                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes                  | 56 route files (10.9k lines), 39 user-facing routes                                                                                                                                                                 |
| Components              | 391 files, 48.9k lines. The biggest directories are `chat/` (6.2k), `ui/` (6.4k), `slate-editor/` (4.8k), `icons/` (4.0k, 91 SVG components), `modals/` (3.7k) and `integrations/` (3.7k)                           |
| UI kit                  | 55 React Aria Components primitives styled with Tailwind v4, `tailwind-variants` (15 files), `tailwindcss-react-aria-components` variants (`selected:`, `pressed:`, `entering:`…) and `data-slot` hooks (362 lines) |
| State                   | 33 effect-atom files (RPC atoms plus UI state), 24 Electric-synced TanStack DB collections, ~97 `useLiveQuery` call sites, and `db/actions.ts` (970 lines of optimistic mutations)                                  |
| Transport               | Effect RPC over HTTP NDJSON (`HazelRpcClient`, 72 call sites), `HazelApiClient` HTTP API (14 files), Rivet actor websocket for streaming AI messages                                                                |
| React-only dependencies | Slate (22 files), frimousse, @legendapp/list, motion (10 files), react-tweet, @videojs/react, embla, input-otp, sonner (47 files), Clerk prebuilt components (3)                                                    |
| Dead dependencies       | realtimekit-react(-ui), react-error-boundary, @paper-design/shaders-react, react-stately, remark-gfm/math, class-variance-authority. Drop them now; they are out of scope                                           |
| Tests                   | 18 vitest files. The Slate markdown serializer suite (1014 lines) is a useful spec. No route or e2e tests                                                                                                           |

**Foldkit** (0.166.0, studied from source):

- Elm Architecture on Effect. The app is one Schema-typed Model. `update` returns Commands (named Effects), and `view` builds HTML through a Snabbdom-based builder with Tailwind classes passed as strings.
- **Fits well:**
    - Effect services are provided once through `resources`, so the existing `RpcClient` layer drops straight in. The typing-game example does exactly this.
    - External streams become `Subscription`s.
    - Sockets and media become `ManagedResource`s.
    - Imperative widgets attach through `Mount`.
    - Typed bidirectional routing.
    - Headless `@foldkit/ui` components: Dialog, Menu, Popover, Tooltip, Toast, Listbox, Combobox, Tabs, DragAndDrop, FileDrop, Calendar, DatePicker, VirtualList, Animation.
    - Story and Scene tests.
    - A DevTools MCP an agent can use to inspect the running Model.
- **Gaps that affect us:**
    - There is no React interop. Its own docs say so: "no escape hatch".
    - Routes are a flat union with no layout nesting; layouts are view helpers.
    - No per-route code splitting.
    - VirtualList has no bottom-anchored mode and no dynamic measurement.
    - Menu has no submenus and no context menus.
    - Data attributes follow Headless UI conventions (`data-active`, `data-closed`, `data-enter`), not React Aria's.
    - HMR is a full reload that restores the Model.
    - It is pre-1.0 and breaks APIs often: ~31 minor versions between 0.135 and 0.166.
    - It pins `effect` and `@effect/platform-browser` to exactly `4.0.0`, while the repo is on 4.0.1.

---

## 2. Strategy

### 2.1 A new app, cut over in one switch

The new app is built in `apps/web-foldkit` next to the old one. It ships once every route reaches parity, through a beta channel first.

Alternatives considered and rejected:

- **Embedding Foldkit inside the React app** (`Runtime.embed`, strangler-style). Each embedded widget becomes its own runtime with its own Model, which throws away the single-Model architecture that is the reason to migrate. It would also tie Foldkit's code to React's routing and providers for the whole migration.
- **Route-by-route split across two SPAs.** The sidebar and shell are on every route, so the user would switch frameworks on every click.

The parity harness is what makes building in parallel and cutting over in one switch safe. We never ship a screen we haven't proven matches.

### 2.2 Freeze the reference UI

- The baseline is `bun run parity build legacy`, which builds `LEGACY_BASELINE_REF` (`packages/ui-parity/src/config.ts`). It started at `0126176e0`, was re-pinned to `ef1fce35b` on 2026-10-07 to add the component gallery, to `6f7eccf00` the same day to add the UI kit and composer gallery entries, and to `639aa8d26` to add the kit follow-up galleries (toast, list box, calendar, date picker, table selection). Every existing scenario stayed identical each time. Move it forward only on purpose (§6.3).
- Any change to the legacy UI after the pin creates migration debt. Policy: no visual changes to legacy screens that are already ported unless the Foldkit side gets the same change in the same PR, followed by a re-pin.

### 2.3 Reuse everything that isn't React

A lot of `apps/web` is plain TypeScript or Effect code. It moves, unchanged, into a new shared package, `packages/web-core`, used by both apps:

| Module                                                                            | Lines | Notes                                                                                         |
| --------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `db/collections.ts`, `db/actions.ts`, `libs/effect-electric-db-collection`        | ~1.5k | Collections plus optimistic actions. TanStack DB core has no framework dependency             |
| `lib/services/common/*` (RPC client, runtime)                                     |       | Becomes the Foldkit `resources` layer                                                         |
| `lib/theme/*`, `lib/helper/generate-shades.ts`                                    | ~950  | CSS-variable theming, presets, remix                                                          |
| `lib/error-messages.ts`, error mapping in `lib/toast-exit.tsx`                    | ~1k   | Exit-to-message mapping. The toast rendering part is React                                    |
| `lib/search-filter-parser.ts`, `utils/timezone.ts`, `utils/presence.ts`           | ~600  |                                                                                               |
| `lib/notifications/*`, `notification-sound-manager.ts`, `native-notifications.ts` | ~700  | Orchestrator plus sinks                                                                       |
| `lib/hotkeys/hotkey-registry.ts`                                                  | 91    | Binding definitions; Foldkit `keyBindings` consumes them                                      |
| `lib/upload-to-storage.ts`                                                        | 82    | XHR with progress                                                                             |
| `lib/clerk-token.ts`, `lib/tauri*.ts`, `lib/platform-storage/*`                   |       |                                                                                               |
| `styles/theme.css`, `styles/styles.css`, `styles/code-syntax.css`                 | ~1k   | Imported by both apps. This is the main reason pixel parity is achievable                     |
| Icons: the 91 SVG components                                                      | 4k    | Generate Foldkit view functions from the same SVG source with a script; don't rewrite by hand |

Extracting a module must not change behavior. The check is a parity run of current `main` against the pinned baseline (`--baseline legacy --candidate legacy` with a fresh build), which has to report `identical` across the board. The same harness that guards the port also guards these refactors.

---

## 3. Architecture of `apps/web-foldkit`

```
apps/web-foldkit/src
├── entry.ts               Runtime.makeApplication({ resources, routing, subscriptions, … })
├── route.ts               AppRoute union + routers (flat, ~40 variants)
├── model.ts / message.ts / update.ts / view.ts    root program
├── resources.ts           Layer.mergeAll(RpcClientLive, HttpApiClientLive, CollectionsLive, ClerkLive, PlatformLive)
├── data/                  live-query subscriptions (see 3.2), optimistic command wrappers
├── shell/                 org shell, sidebar, mobile nav, app nav: view helpers + Submodel state
├── page/<area>/<page>/    one Submodel per page: model, message, update, view, subscription, scene.test
├── ui/                    hazel design-system primitives on @foldkit/ui (see 3.3)
├── mount/                 imperative widgets: editor, video, carousel, Clerk components, motion
└── styles.css             @import "@hazel/web-core/styles/*" + custom variants
```

### 3.1 Routing and layouts

- One flat `AppRoute` union mirroring the 39 legacy routes. `defaultIds`-style branded segments come from `schemaSegment('id', ChannelId)`.
- Layouts are view helpers: `orgShell(model, h, page)` wraps every `/$orgSlug/*` page, and `settingsShell` and `channelSettingsShell` work the same way. Shell state (sidebar collapse, panel widths, section collapse) lives in a `shell` Submodel at the root, so it survives navigation.
- Page Submodels are optional (`maybeChatPage`). Navigating builds a page with `foldChildInit` and drops the previous one, which matches React's unmount semantics.
- The redirects legacy does in `beforeLoad` (`/_app/index`, `channels/$id/settings/index`) become `onUrlChange` → `Navigation.replaceUrl` Commands.
- There is no code splitting. Measure the bundle in Phase 0. If it is a problem, lazy-load heavy _libraries_ (editor, video.js, embla) inside their Mounts with dynamic `import()`. That is supported because Mount `execute` is an Effect.

### 3.2 Data: TanStack DB stays, the Model holds query results

> **Decision to confirm in Phase 0, spike S2.**

- **Keep** Electric plus the TanStack DB collections plus `db/actions.ts` as the sync and optimistic-update engine. The 970 lines of optimistic actions and the Electric protocol handling are already debugged and aren't React code.
- **Bridge** with one generic `liveQuery` Subscription factory. It takes a query builder plus Schema-typed dependencies (for example `channelId`), runs `createLiveQueryCollection` and `subscribeChanges`, and dispatches `UpdatedX({ rows })` with Schema-decoded rows. Pages own their query results in their Model. When dependencies change, the Subscription re-keys, which is the equivalent of `useLiveQuery` deps.
- **Mutations** are Commands that call the existing optimistic actions and map `Exit` to Messages (`SucceededSendMessage` / `FailedSendMessage`). The toast mapping comes from web-core.
- **Trade-off:** query results are a copy of collection state, which bends Foldkit's "store each piece of state once" rule. The alternative is an Electric ShapeStream feeding a normalized store in the Model, with optimistic layers in `update`. That is purer, but it means rewriting ~1.5k lines of tested sync code and holding every synced row in a deep-frozen Model. S2 measures both on 10k messages and 500 channels.
- RPC queries (`user.me`, `organization.getBySlugPublic`, `chatSync.connection.list`) become Commands issued from `init`/route entry, with results in the Model as `AsyncData`.
- Streaming AI messages (the Rivet actor) become a `ManagedResource` for the connection plus a Subscription for the token stream.

### 3.3 The design system: same classes, different engine

Pixel parity depends on producing **the same DOM boxes with the same class strings**. The kit in `apps/web-foldkit/src/ui` mirrors `apps/web/src/components/ui` one to one (same names, same variants, same `tv()` definitions, imported from web-core where possible) and is built on `@foldkit/ui`.

How to bridge the attribute-convention differences:

| React Aria hook                                  | Foldkit equivalent                                             | Approach                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selected:` / `data-[selected]`                  | `data-selected`                                                | Same attribute, works unchanged                                                                                                                                     |
| `focused` (item)                                 | `data-active`                                                  | `@custom-variant` in the Foldkit app's CSS maps the RAC variant name onto Foldkit's attribute                                                                       |
| `entering:` / `exiting:`                         | `data-enter` / `data-leave` / `data-closed`                    | Custom variants; animation durations are taken from the legacy CSS                                                                                                  |
| `pressed:`, `hovered:`, `focus-visible:`         | no attribute                                                   | Custom variants map to `:active`, `:hover`, `:focus-visible` (RAC's hover/press have touch-specific semantics; capture differences in parity interaction scenarios) |
| `open:`, `disabled:`, `invalid:`, `placement-*:` | `data-open`, `data-disabled`, `data-invalid`, `data-placement` | Custom variants                                                                                                                                                     |
| `data-slot=…`                                    | n/a                                                            | Emit the same `data-slot` attributes so parent selectors keep working                                                                                               |
| `composeRenderProps` render functions (52 sites) | `itemToConfig(item, { isActive, isSelected })`                 | Compute classes from Model state                                                                                                                                    |

Where `@foldkit/ui` can't produce the needed DOM, build the primitive directly on `h` plus `Anchor`/floating-ui. Known cases: Menu/Listbox item wrappers only accept `className` and `content`; menus need submenus and context menus (`ui/context-menu.tsx`); Menu/Combobox items are restricted to string types. Upstream fixes where they're general.

Every primitive gets an isolated parity scenario on a component gallery route (§6.2), so layout bugs are caught at the primitive level before they spread to 40 screens.

### 3.4 React-only dependencies

| Legacy                                                             | Replacement                                                                                                                                                                                    | Notes                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slate composer and viewer (22 files, 4.8k lines)                   | Composer: **ProseMirror or Tiptap (vanilla) in a `Mount`** (`Mount.defineStream` emits doc changes). Viewer: a **pure Foldkit view** of a parsed markdown AST (no editor instance per message) | Biggest risk. Spike S3 picks the editor. The serializer's 1014-line test suite becomes the spec for markdown round-trips. Command-palette search editor: same Mount |
| `@legendapp/list` message list                                     | Custom bottom-anchored list: a Mount measures row heights (ResizeObserver) and a Subscription reports them, with prepend anchoring and stick-to-bottom in `update`                             | Spike S4. Visually inert, so screenshots can't regress from it, but scroll behavior needs Scene tests plus manual QA                                                |
| frimousse emoji picker (314 lines)                                 | Rewrite with Foldkit (grid plus search over the same emoji data)                                                                                                                               | Small                                                                                                                                                               |
| sonner (47 files)                                                  | `@foldkit/ui` Toast, restyled to sonner's markup and classes                                                                                                                                   | Toast position and stacking get parity scenarios with a fixture-triggered toast                                                                                     |
| motion (10 files)                                                  | CSS animations where possible; `motion` vanilla `animate()` in Mounts for onboarding, globe and agent steps                                                                                    | Parity runs freeze animations, so verify end states and check motion manually                                                                                       |
| @videojs/react                                                     | video.js vanilla in a Mount                                                                                                                                                                    |                                                                                                                                                                     |
| embla-carousel-react                                               | `embla-carousel` vanilla in a Mount                                                                                                                                                            |                                                                                                                                                                     |
| react-tweet                                                        | Use `react-tweet/api` (framework-free fetch) plus a Foldkit view that copies its markup                                                                                                        |                                                                                                                                                                     |
| input-otp                                                          | Rewrite (one input plus visual slots)                                                                                                                                                          |                                                                                                                                                                     |
| Clerk `<SignIn>`, `<SignUp>`, `<CreateOrganization>`               | `Clerk.mountSignIn(el)` and friends in a Mount: clerk-js's own vanilla API                                                                                                                     | Auth state: a Subscription on `Clerk.addListener`; token via web-core `getClerkToken`                                                                               |
| `@tanstack/react-form` + arktype                                   | `foldkit/fieldValidation` (Schema rules)                                                                                                                                                       | arktype schemas get ported to Effect Schema                                                                                                                         |
| `@tanstack/react-hotkeys`                                          | `Dom.streamFromKeyBindings` fed from the web-core registry plus user overrides in the Model                                                                                                     |                                                                                                                                                                     |
| effect-atom UI state (modals, panels, command palette, chat state) | Model fields and Submodels                                                                                                                                                                     | e.g. `modal-atoms` becomes a `Modal` union in the root Model                                                                                                        |
| PostHog provider                                                   | Plain `posthog-js` calls in Commands                                                                                                                                                           |                                                                                                                                                                     |

### 3.5 Platform

- **Tauri:** `@tauri-apps/*` APIs are already framework-agnostic. Window state, deep links, updates, autostart and menu events become Commands and Subscriptions. Point `apps/desktop` at the new app's dev URL and dist with a flag during beta.
- **PWA:** keep `vite-plugin-pwa` in the new Vite config. `version-check` becomes a Subscription.
- **Presence** (649-line hook): visibility, AFK and BroadcastChannel become Subscriptions; heartbeat becomes a `Subscription` timer plus Command. Logic is extracted into web-core where it's pure.

---

## 4. Phases

Each phase ends with a parity milestone. Phases 3 to 5 can be staffed in parallel by people or agents once Phase 2 lands.

### Phase 0: Spikes and decisions

Every spike produces a short decision record in `docs/foldkit-decisions/`.

| Spike                                                       | Question                                                    | Exit criterion                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Skeleton ✅ ([record](foldkit-decisions/s1-skeleton.md)) | Can Foldkit boot our stack?                                 | `apps/web-foldkit` builds with the parity env; `window.Clerk` auth, RPC `resources`, `user.me`; `settings-team` scenario **identical**  |
| S2 Data bridge ✅ ([record](foldkit-decisions/s2-data.md)): keep the TanStack DB bridge | TanStack DB bridge vs a normalized Model store              | Benchmark on a `heavy` dataset (10k messages, 500 channels): update latency, render time, memory, dev-mode freeze cost. Decide §3.2     |
| S3 Editor ✅ ([record](foldkit-decisions/s3-editor.md)): ProseMirror | ProseMirror vs Tiptap vs Lexical in a Mount                 | Composer scenario **identical** (empty, focused, with draft); serializer suite passes against the new model; mention autocomplete works |
| S4 Chat list ✅ desktop ([record](foldkit-decisions/s4-chat-list.md)); mobile waits on the Phase 2 shell | Bottom-anchored virtualization                              | 10k-message channel scrolls at 60fps, prepend keeps position, sticks to bottom on new message                                           |
| S5 Primitive parity ✅ ([record](foldkit-decisions/s5-primitives.md)): 41 primitives, 315 identical + 23 pass, 0 fail | Do custom variants plus `@foldkit/ui` reach pixel identity? | Button, Menu (open), Dialog, Tooltip, Select, Tabs all **identical** in the gallery, in both themes                                     |
| S6 Effect pin ✅ (runs on 4.0.1, see S1)                    | Foldkit peers `effect@4.0.0` exactly                        | Either Foldkit runs on 4.0.1 (bun `overrides`, verify tests) or Foldkit releases support 4.0.1                                          |

If S3 or S4 fails badly, stop and reconsider. Those two are the migration's load-bearing walls.

### Phase 1: Foundations

- Extract `packages/web-core` (§2.3), with legacy-vs-legacy parity identical after each extraction.
- Create `apps/web-foldkit`: Vite with `@foldkit/vite-plugin` and Tailwind, styles imported from web-core, custom variants (§3.3), `resources`, routing skeleton for all 39 routes (each renders a placeholder), and Clerk auth Subscription.
- Icon generation script.
- The full UI kit (55 primitives), each with a gallery scenario.
- Done when the gallery is identical for every primitive at desktop × light/dark, including open, hover and focus states.

### Phase 2: App shell

- Org layout: sidebar (sections, favorites, DMs, unread badges, collapse), app nav rail, mobile nav, user menu, org switcher, Tauri titlebar padding.
- Command palette (all 6 pages; the search page depends on the S3 editor).
- Modals system (the `Modal` union) and toasts.
- Theme switching and appearance presets (`my-settings/index`).
- Done when the `nav-*` scenarios are identical, and every page placeholder renders inside an identical shell.

### Phase 3: Chat, read path

- Message list (S4), message rendering (markdown view, code highlighting with prismjs through the web-core decorator logic, mentions, custom emoji), reactions display, attachments, embeds (GitHub, Railway, OpenStatus, tweets, YouTube, link previews, GIFs), date separators, the hover toolbar, threads panel, pinned messages, files and media tabs, typing indicators, channel join banner.
- Done when every `chat-*` scenario is identical, plus new scenarios for threads, embeds (the `dev/embeds` fixtures), attachments, and long and grouped messages.

### Phase 4: Chat, write path

- Composer (S3): send, edit, reply, mentions, bot commands, emoji and GIF pickers, drag-and-drop and paste uploads with progress, slash commands.
- Reaction toggle, delete, pin, thread creation, channel and DM creation.
- Keyboard flows: global typing redirects into the composer, Esc and arrow-key editing.
- Done when interaction scenarios are identical and **behavioral parity** holds: the same RPC calls with the same payloads for each interaction (§6.2).

### Phase 5: Everything else (parallel)

Independent screens. Each is one ticket and one agent-sized unit. Rough size from legacy line counts:

| Area                                     | Routes                                                            | Legacy lines            | Notes                                       |
| ---------------------------------------- | ----------------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| Notifications                            | 5                                                                 | ~200 + list             |                                             |
| My settings                              | profile, notifications, linked accounts, desktop                  | ~920                    | profile picture crop (pointer interaction)  |
| Org settings                             | general, team, invitations, custom emojis, debug, connect invites | ~2.3k                   | custom emojis has drag-and-drop upload      |
| Integrations                             | index, installed, marketplace, your apps, `$integrationId`        | ~1.7k + 3.7k components | `$integrationId` is the largest route (969) |
| Chat sync                                | index, `$connectionId`                                            | ~1.2k                   |                                             |
| Channel settings                         | overview, integrations, connect                                   | ~1k + 2.7k components   |                                             |
| Org home, channel browser, profile       | 3                                                                 | ~760                    |                                             |
| Onboarding, join, select org, auth pages | 6                                                                 | ~800                    | motion; Clerk Mounts                        |

### Phase 6: Platform and polish

- Tauri (desktop build of the new app), PWA, native notifications and sounds, presence, deep links, analytics, error reporting.
- Accessibility pass: Foldkit UI hasn't had a screen-reader audit. Compare against React Aria behavior using `parity` accessibility snapshots (§6.2).
- Performance budget: bundle size, time to interactive, memory with heavy data, compared against legacy.

### Phase 7: Cutover

1. Beta: local only for now (§8). The team runs the Foldkit build locally against the real backend.
2. Parity freeze: every route covered, every scenario identical, no unmocked RPCs, behavioral parity green.
3. Switch `app.hazel.sh`, keep legacy deployable for a two-week rollback window, then delete `apps/web` and the legacy-only dependencies.

---

## 5. Definition of done (per screen)

- [ ] Every scenario for the route is `identical` at desktop and mobile (if the screen is responsive) × light and dark.
- [ ] Scenarios cover all visible states: default, empty, loading, error, overflow (long names), and each interactive overlay (menus, dialogs, tooltips, hover and focus).
- [ ] Behavioral parity: each scenario's interactions issue the same RPC calls with the same payloads in both apps.
- [ ] Scene tests cover the page's update logic; Story tests cover non-trivial state machines.
- [ ] Accessibility roles and names match legacy (parity steps use accessible locators, so they enforce this), or deliberately improve on it with a note in the PR.
- [ ] Checked manually side by side with `bun run parity serve` for the motion and scroll behavior that screenshots can't see.

---

## 6. Parity harness roadmap

What exists today: fixture backend, Clerk stub (signed in per dataset, or signed out), deterministic capture, pixel and structural diff, HTML report, `selfcheck`, `coverage` (38 of 39 routes as of 2026-10-07), parallel runs (`PARITY_PORT_BASE`), the component gallery, and datasets `default`, `member`, `errors`, `integrations`, `onboarding`, `empty`, `signed-out`, `multi-org`, `inbox`, `personal-*`. Additions in order of need:

### 6.1 Coverage (before Phase 1, parallelizable)

- Scenarios for the remaining 29 routes.
- Datasets:
    - `empty` (new org, no channels)
    - `heavy` (500 channels, 10k messages, long names, many unreads)
    - `member` (non-admin, so permission-gated UI is hidden)
    - `onboarding` (`isOnboarded: false`)
    - `rich` (threads, embeds, attachments, pinned messages, custom emojis, bots, integrations)
    - `errors` (selected RPCs fail, to cover toasts and error states)

### 6.2 New capabilities

- **Component gallery:** add a `/_dev/gallery/*` route to legacy (then re-pin) and the same to Foldkit, one scenario per primitive state. This is the fastest feedback loop in Phase 1.
- **Behavioral parity (done):** the fixture backend records every RPC (tag plus payload) and HTTP API request per capture, and `compare` diffs the call logs between apps, order-insensitive, with presence and typing noise excluded (see the ui-parity README). A difference fails the variant.
- **Accessibility snapshots (done, report-only):** every capture stores `page.locator("body").ariaSnapshot()`, and `summary.md` lists the deltas grouped by role. That catches role and name regressions that pixels miss. Variants fail on it only with `--strict-a11y`, until the existing deltas are triaged; then make it the default.
- **Timed states:** dataset-level response delays (`rpcDelayMs`, shape delay) so loading states can be captured deliberately.
- **Fixture-driven live events:** push an Electric change during a scenario (new message arrives, typing indicator appears) for real-time UI states.

### 6.3 CI and baseline management

- Run parity in a pinned Docker image (fonts render differently across OSes, so local and CI captures must never be mixed).
- GitHub Action on PRs touching `apps/web-foldkit` or `packages/web-core` runs the scenarios for touched areas and posts the summary plus a report artifact.
- Re-pinning the baseline is a deliberate PR. It updates the ref in config and includes the regenerated report showing what changed.
- Track progress: `coverage` plus the latest run's status per route. This is the migration burndown.

---

## 7. Risks

| Risk                                                         | Likelihood | Impact | Mitigation                                                                                         |
| ------------------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------------- |
| Editor replacement can't match Slate's behavior and markup   | Medium     | High   | S3 before anything else; the serializer spec; run the editor's DOM output through the same classes |
| Chat list virtualization or scroll anchoring regresses       | Medium     | High   | S4; Scene tests on scroll Messages; manual QA checklist                                            |
| Foldkit API churn (pre-1.0, ~weekly breaking renames)        | High       | Medium | Pin exact versions; upgrade on a schedule in dedicated PRs; parity proves no visual change         |
| Effect version pin (`4.0.0` exact) blocks repo upgrades      | Medium     | Medium | S6; coordinate with Foldkit maintainers; overrides                                                 |
| Single-Model performance with large synced data              | Medium     | High   | S2 benchmark; keep the bulk data in TanStack DB (§3.2); `createKeyedLazy` for message rows         |
| Overlay positioning differs (RAC positioning vs floating-ui) | High       | Low    | Per-overlay scenarios; tune offset and flip middleware to match                                    |
| Accessibility regressions (Foldkit UI not audited)           | Medium     | Medium | Accessibility snapshots (§6.2); keyboard flows in Scene tests                                      |
| Legacy keeps changing during migration                       | High       | Medium | Pinned baseline plus the "port with the change" policy (§2.2)                                      |
| Bundle size without route splitting                          | Low        | Medium | Measure in S1; lazy-load heavy libraries inside Mounts                                             |
| Two codebases for months                                     | Certain    | Medium | Shared web-core; finish Phase 2 fast so all later work is parallel                                 |

---

## 8. Decisions

Decided (2026-10-07):

- **Legacy UI freeze policy** (§2.2): any PR that changes the legacy UI gets a review subagent first. It runs parity against the pinned baseline and flags visual changes to screens that are already ported. A flagged change has to land on the Foldkit side in the same PR, followed by a re-pin.
- **Beta rollout:** local only for now. `bun run parity serve` and a local Foldkit build; no subdomain or toggle yet.
- **Foldkit upstream:** keep missing pieces (submenus, bottom-anchored VirtualList, React Aria-compatible item attributes) local in `apps/web-foldkit/src/ui` for now.

Still open:

1. ~~**Data layer**~~ decided 2026-10-07 by S2: **keep the TanStack DB bridge**, with a capped loaded window, change sets instead of full arrays, and incremental row derivation ([record](foldkit-decisions/s2-data.md)).
2. ~~**Editor**~~ decided 2026-10-07 by S3: **ProseMirror** (vanilla) in a Mount. Composer gallery scenarios identical, serializer suite 78/78 ([record](foldkit-decisions/s3-editor.md)).

---

## 9. Working agreement for agents

Porting one screen:

```bash
bun run parity coverage                       # pick an uncovered or failing route
# 1. add or extend scenarios in packages/ui-parity/src/scenarios.ts; selfcheck must stay deterministic
bun run parity selfcheck --filter <area>
# 2. port the page into apps/web-foldkit/src/page/<area>/<page>/
bun run parity build foldkit && bun run parity run --filter <area>
# 3. read .parity/runs/<run>/summary.md, fix root causes first (grouped style deltas), repeat until identical
```

- Fix root causes, not symptoms. A grouped `font-weight` delta on 18 runs means one wrong class in a shared primitive, not 18 page fixes.
- Never edit the baseline to make a diff pass. If legacy itself is wrong, fix it in legacy, re-pin, and say so in the PR.
- Never add CSS selectors or test IDs to scenario steps. If an accessible locator can't find something in Foldkit, the port is missing a role or label.
- Use the Foldkit DevTools MCP to inspect the Model when behavior differs.
