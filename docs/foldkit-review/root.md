# Foldkit review: root (app, shell, overlays, platform, data, page contract)

Branch `fk/review-root` (from `experiment-2.0` 7d7b2e69f), Foldkit 0.167.0. Scope: `apps/web-foldkit/src/{main,entry,route,redirect,session,rpc,theme,notification-sound}.ts`, `app/`, `shell/`, `overlay/`, `platform/`, `data/`, `page/{contract,registry,out-message}.ts`.

Rules checked against [architecture](https://foldkit.dev/core/architecture), [testing](https://foldkit.dev/testing), [Story](https://foldkit.dev/testing/story), [Scene](https://foldkit.dev/testing/scene) and the installed `foldkit` source. Every finding below was verified in code; the bugs are pinned by `it.fails` tests that fail for exactly the stated reason.

## Bugs (found by tests)

### B1. The sign-in return URL loses its `?`, so deep links with a query 404 after sign-in

- `main.ts:244`: `currentUrl: () => \`${url.pathname}${Option.getOrElse(url.search, () => "")}\``
- Foldkit's `Url.search` holds the query **without** the `?` (`foldkit/dist/url/index.js`, `String.split(pathAndQuery, "?")`). `/hazel/settings/team?tab=roles` becomes `redirect_url=/hazel/settings/teamtab=roles`, which parses to `NotFound` after sign-in. Every signed-out deep link with a query is hit: `/hazel/chat/<id>?messageId=...` from a notification email, OAuth callbacks, `/onboarding?orgId=`.
- Test: `app/routing.story.test.ts` "the return URL keeps the search params" (`it.fails`).
- Fix (low risk): `Option.match(url.search, { onNone: () => "", onSome: (search) => \`?${search}\` })`, or `Url.toString` minus the origin.

### B2. Switching organization from the mobile org switcher does nothing

- `shell/update.ts:118-139` (`switchedOrganization`) skips a key that is already in `model.orgSwitcher.selectedKeys`. On mobile the menu runs in `"Single"` selection mode, and the kit's `activated` (`ui/menu.ts:337`) sets `selectedKeys = [key]` **before** `Update.foldChild` hands the OutMessage to `foldOrgSwitcherOutMessage`. So the clicked org always looks like the current one, no `RequestedNavigation` is emitted, and `withMenuEntries` then resets the selection back to the current org. Desktop works because its submenu runs in `"None"` mode.
- Tests: `shell/shell.story.test.ts` "another organization navigates to its slug" and "an organization without a slug goes back to setup" (`it.fails`). The desktop path passes.
- Fix (low risk): compare against the organization the shell is showing (`context.organizationId`, passed into `update`) instead of the menu's post-click selection.

### B3. A status picked in the command palette is overwritten when the user goes AFK

- Legacy `usePresence().setStatus` writes `manualStatusAtom`, and `computedPresenceStatusAtom` returns the manual status ahead of the AFK-derived `away`/`online` (`apps/web/src/hooks/use-presence.ts:175-181`, `454-470`). The port's `SetPresenceStatus` (`overlay/command-palette/commands.ts:57-65`) only sends the RPC; `platform/presence` has no manual status (`platform/presence/model.ts:11`, `computedStatusOf`). After "Do Not Disturb", the 15-minute AFK timeout sends `status: "away"` and the next activity sends `"online"`.
- Test: `app/out-messages.story.test.ts` "a picked status survives going AFK" (`it.fails`, fails with `SendPresenceUpdate {"status":"away"}`).
- Fix (design change, small): add `manualStatus: NullOr(PresenceStatus)` to the presence Model, set it through a palette OutMessage (`RequestedPresenceStatus`) that the root forwards to `Platform`, and let `computedStatusOf` prefer it, as legacy does.

### B4. Back in the palette restores an empty search instead of what was typed (probable)

- `overlay/command-palette/update.ts:93-98`: `remember` reads `model.menu.inputValue`, but `gotMenuMessage` calls it with the menu **after** `CommandMenu.update` ran `activated`, which `reset`s the input (`ui/command-menu.ts:148`). The stored history entry is always `inputValue: ""`. Legacy `navigateTo` pushes `prev.currentPage` with its `inputValue` (`apps/web/src/hooks/use-command-palette.ts:55-61`).
- Test: `overlay/command-palette/palette.story.test.ts` "a sub-page remembers the home search, and Back restores it" (`it.fails`). Marked probable: confirm with a parity scenario (type, open a sub-page, press Back) before fixing.
- Fix (low risk): remember the page from the pre-update `model.menu.inputValue`, i.e. compute `remember(model)` before folding the menu message.

## Bug risk (verified in code, not covered by a failing test)

### R1. `Effect.promise` around fallible promises turns failures into app crashes

The runtime crashes the whole app when a Command's Effect dies (`foldkit/dist/runtime/runtime.js:253`, `Effect.catchCause(cause => crashWith(cause, message))`), and `Effect.promise` turns a rejection into a defect.

- `app/clerk.ts:51` `signOut`: a rejected `clerk.signOut` (network) crashes the app instead of failing a sign-out.
- `platform/rivet.ts:15` `acquireRivetClient`: a failed dynamic `import()` (deploy skew, offline) is a defect, so the declared `onAcquireError` / `FailedAcquireRivetClient` (`platform/index.ts:72`) is unreachable.
- `data/live-query.ts:26`, `data/live-query-changes.ts:48`, `overlay/modal/create-dm-data.ts:80,101`: `cleanup()` / `toArrayWhenReady()` rejections.
- Fix (low risk): `Effect.tryPromise` with a `Schema.TaggedError`, mapped to a `Failed*` Message (`FailedSignOut`, `FailedAcquireRivetClient` already exists). Release paths can `Effect.ignore`.

### R2. Template-string URLs can produce a protocol-relative URL

- `overlay/command-palette/update.ts:124,139,211`, `overlay/command-palette/search-update.ts:81`, `overlay/modal/create-dm.ts:53`, `overlay/modal/new-channel.ts:113`, `overlay/modal/delete-channel.ts:80` build `/${shared.orgSlug ?? ""}/chat/...`. With a null slug that is `//chat/<id>`, a protocol-relative URL that `pushUrl` would treat as host `chat`. Unreachable today (the palette and modals only render inside the org shell), but nothing in the types prevents it. See A1 for the structural fix; the local fix is to return `{ model }` when `orgSlug` is null.

### R3. Commands read state from the DOM instead of the Model

- `overlay/modal/delete-channel.ts:42` reads `window.location.pathname` inside `DeleteChannel` to decide whether to leave the page. The root already holds `pathname`; pass it (or the route) into the modal as an arg so the decision is in `update` and testable.

## Architecture violations

### A1. Routes are typed for parsing only; every URL is string-built (needs a design change)

[Routing](https://foldkit.dev/core/architecture) is bidirectional in Foldkit: routers made with `Route.mapTo` expose `.build` (`foldkit/dist/route/parser.d.ts`, `Router<A>`). `route.ts` builds the routers inline in `orgRouters` and never exports them, so ~50 sites (`grep '\`/\${'`) hand-build paths: `redirect.ts:14,18,45`, `shell/app-shell.ts:52`, `shell/layouts.ts:54,72`, `shell/menus.ts:42,44,72`, `shell/mobile.ts:21`, `shell/sidebars.ts:68,161,202`, `shell/update.ts:133`, `shell/channels-sidebar/items.ts:28`, the palette and modals above. `RequestedNavigation.href` and `Completed.href` are `Schema.String`.

Suggested fix: export one router per route tag (`routes.chatChannel({ orgSlug, channelId })`), make OutMessages carry an `AppRoute` instead of an `href`, and let the root print it. Do it incrementally, one OutMessage field at a time.

### A2. Module-level mutable state outside the Model

- `app/notification-sinks.ts:21-23`: `sessionStartTime = new Date()` at import, plus the sound and native sinks; `wireNotificationSinks` reconfigures the legacy singletons (`setDependencies`) on every dependency change. `getContext` reads `document.hasFocus()` and `Date.now()` lazily, which is fine inside the stream, but the session start is captured at module load, not app start. Make the orchestrator and sinks a Foldkit `Resource` and pass `sessionStartMs` through Flags.
- `overlay/command-palette/search-editor.ts:191`: `const editors = new Map<string, EditorView>()`; the search Mount registers its ProseMirror view and Commands (`search-mount.ts:60`, `DeleteFilterText`) look it up by id. That is a hidden channel from a Mount to Commands. A ManagedResource keyed on "search page open" gives the same handle with `ResourceNotAvailable` handling.
- `platform/presence/activity.ts:30`: `let sender: BroadcastChannel | undefined`, lazily created and never closed. Make it a Resource.
- `app/clerk.ts:31`: `let unsubscribe` inside the acquire. Return it from the acquire instead (the release already receives the acquired value).
- `data/actions.ts:11`: the shared `AtomRegistry` is a deliberate decision (one registry like legacy); keep, but document it in `page/README.md` as the one sanctioned singleton.

### A3. `update` and `view` read the clock

[Architecture](https://foldkit.dev/core/architecture): update and view are pure.

- `overlay/command-palette/search-update.ts:70`: `Date.now()` in `openResult` (an update path) stamps the recent search.
- `overlay/command-palette/search-view.ts:157`, `overlay/command-palette/search-result.ts:215`: `formatDistanceToNow(..., Date.now())` in the view.
- `shell/menus.ts:118`: the user menu view calls legacy `formatStatusExpiration`, which does `new Date()` (`apps/web/src/utils/status.ts:74`).
- Fix (low risk): use `shared.nowMs` (already ticked every 30 s by the root) in all four; pass `nowMs` into `formatStatusExpiration` via a small pure wrapper.

### A4. The parent writes into the shell's Model

- `main.ts:199-203`: `RequestedMobileSidebar` sets `shell.isSidebarOpen` with `modifyFields`, bypassing `Shell.update`. The view does the right thing for the same fact (`app/view.ts:41`, `Shell.Message.ToggledSidebar`). Route it through `Shell.update(model.shell, ToggledSidebar({ isOpen: true }), ...)` so the shell owns its state ([Submodels](https://foldkit.dev/core/architecture)).

### A5. Two redirects for one route

- `redirect.ts:13-15` (`routeRedirect`) and the `ChannelSettingsRedirect` page (`page/channel-settings/redirect/index.ts`) both replace `/…/settings` with `/…/settings/overview`, so one URL change dispatches two `ReplaceUrl` Commands (pinned in `app/routing.story.test.ts`). Delete one; the page is the README's pattern for redirect-only routes.

### A6. ManagedResource with a constant gate

- `platform/index.ts:67-75`: `rivetClient` has `modelToMaybeRequirements: () => Option.some(null)`, i.e. an app-lifetime singleton. The docs reserve ManagedResources for handles tied to a Model slice and Resources for app-lifetime dependencies. It is a ManagedResource only to get `Acquired/Failed` Messages; with R1 fixed that is reasonable, but gate it on something real (signed in, or the first AI message) or make it a Resource and drop `Model.rivet`.

## Conventions

- **Catch-all result Messages.** `overlay/command-palette/message.ts:45` `CompletedEffect` is the result of `FocusInput`, `TrackRecentChannel` and `SetPresenceStatus`; Messages should say which fact happened (`CompletedFocusInput`, `CompletedTrackRecentChannel`, `SucceededSetPresenceStatus`/`Failed…`). The root does this right (`CompletedNavigateInternal`, `CompletedApplyTheme`).
- **Dead Messages and state.** `shell/channels-sidebar/model.ts:53` `ChangedContext` is never dispatched (handled as a no-op at `shell/channels-sidebar.ts:71`). `shell/model.ts:52-53,70-71`: `collapsedSectionIds`, `panelWidths`, `ToggledSection`, `ResizedPanel` have no producer. Delete them until the feature lands.
- **Stringly typed ids.** `app/message.ts:44` `PressedHotkey.actionId: Schema.String` although `overlay/hotkeys.ts` only emits `AppHotkeyActionId`; `main.ts:128-139` dispatches on it with an `if` chain. Use `Schema.Literals(LAYOUT_ACTIONS)` and `Match`. `overlay/command-palette/model.ts:89`, `message.ts:17` `recentChannelIds: Schema.Array(Schema.String)` and `commands.ts:82` `TrackRecentChannel.channelId: Schema.String` should be `ChannelId` (decode at the storage boundary, as `readRecentChannelIds` already does).
- **Unchecked casts at the data bridge.** `data/live-query.ts:20` `collection.toArray as ReadonlyArray<Row>` (and `live-query-changes.ts:29,34,39`): rows are trusted, not decoded. This is the documented S2 decision (`docs/foldkit-decisions/s2-data.md`, "Live query rows are typed any"); keep it, but confine the cast to this one module (it is) and say so in a comment. `overlay/command-palette/commands.ts:73` `JSON.parse(raw) as unknown` and `search-mount.ts:43` `element as HTMLElement` are avoidable (`Schema.fromJsonString`, `instanceof` guard).
- **Duplicated helpers.** `overlay/action.ts` (`runAction`, `toastForCause`) duplicates `data/actions.ts` (`runAtomFn`, `failureToast`); `successToast`/`errorToast` exist in both `overlay/out-message.ts` and `data/actions.ts`. Pick `data/actions.ts` and delete the overlay copies.
- **Storage helpers bypassed.** `overlay/command-palette/commands.ts:70-97` and `search-mount.ts:104,115` call `localStorage` directly with `Effect.try`; `shell/channels-sidebar/hints.ts` too. `data/storage.ts` (`readStored`/`writeStored`, the platform KV store, desktop-aware) is the app's storage boundary.
- **Duplicate clocks.** The root ticks `nowMs` every 30 s (`app/subscription.ts:37-41`) for `Shared.nowMs`, and the channels sidebar runs its own presence tick and copies `nowMs` into its Model (`shell/channels-sidebar/subscriptions.ts:51`, `shell/channels-sidebar.ts:73-78`). Pass the root's `nowMs` into the sidebar via its context instead. The root clock is also a `persistentEntry`, so it ticks (and re-renders) on signed-out screens; gate it on `orgSlug !== null`.
- **Prototype code in `src`.** `data/normalized-store.ts` (S2 option b) is only imported by `scripts/bench-s2*`; move it under `scripts/`.
- **Silent failures.** `FailedFetchCurrentUser` is a no-op (`main.ts:358`), which leaves the signed-in shell on the loader forever (pinned in `app/session.scene.test.ts`). Check legacy `AppShell` on a `user.me` error; if legacy shows an error or retries, port that.

## Already good

- One Schema-typed root Model; children folded through explicit `with*`/`foldOverlay` helpers that map Commands with `Command.mapMessages`.
- Messages are past-tense facts throughout the root (`ChangedUrl`, `UpdatedOrganization`, `SucceededFetchCurrentUser`); Commands are named imperatives (`NavigateInternal`, `ApplyTheme`, `DeliverNotifications`).
- Subscriptions are gated on Model slices with `Stream.empty` until their dependencies exist (`organization`, `member`, `recentNotifications`, `layoutHotkeys`, the shell's live queries), and dependency equality is Schema-derived, so they restart exactly when the slice changes.
- The page contract (`page/contract.ts`) is a clean Submodel protocol: `init/update/routeChanged/sharedChanged`, OutMessages up, `Shared` as ViewInputs, page-prefixed Subscription keys, and `key` for instance reuse (pinned in `app/routing.story.test.ts`).
- Theme: Flags read the stored preference before first render, `ApplyTheme` and `SaveThemePreference` are Commands, and only the root touches the DOM (`theme.test.ts`).
- `Match.tag` in `redirect.ts`, `Message.match` everywhere, no `switch`, no `try/catch` in the area.
- Literal wrapper Messages in hot paths (`app/view.ts:27-50`, `app/subscription.ts:176`) are a deliberate, documented trade-off (S2: constructors re-validate large payloads).

## Fix now (low risk) vs. design change

| Fix now | Needs a design change |
| --- | --- |
| B1 `currentUrl` search; B2 compare with `context.organizationId`; B4 remember before folding | B3 manual presence status (new Model field + OutMessage) |
| R1 `Effect.tryPromise` + `Failed*` Messages | A1 typed route builders, OutMessages carrying `AppRoute` |
| R2 bail out on a null `orgSlug`; R3 pass `pathname` to `DeleteChannel` | A2 sinks, search editor and `BroadcastChannel` as Resources/ManagedResources |
| A3 `shared.nowMs` in the palette and user menu; A4 route through `Shell.update`; A5 drop one redirect | A6 Rivet gate or Resource |
| Conventions: `CompletedEffect` split, dead Messages/state, `PressedHotkey` literals, branded `ChannelId`, helper dedupe, storage helpers, `normalized-store.ts` move | Single clock shared with the sidebar |

## Tests added

All under `apps/web-foldkit/src`, run with `bunx vitest run <file>`; root tests use `// @vitest-environment jsdom` like the existing `app/loading.test.ts`.

| File | Kind | Passing | `it.fails` | Covers |
| --- | --- | --- | --- | --- |
| `app/routing.story.test.ts` | Story | 8 | 1 (B1) | links, layout tabs, signed-out gate, join page `user.me`, channel-settings redirect, page instance keys |
| `app/out-messages.story.test.ts` | Story | 11 | 1 (B3) | `RequestedCommandPalette`, `RequestedModal`, `RequestedTheme`, palette `Completed`, `RequestedSignOut`, `RequestedMobileSidebar`, `RequestedSoundSettings`, hotkeys and permissions |
| `app/shell.scene.test.ts` | Scene | 4 | 0 | nav rail current section, mobile bottom nav and sidebar sheet, palette open/Escape, create channel (validation, Command, navigation, toast lifecycle) |
| `app/modal-host.scene.test.ts` | Scene | 4 | 0 | modal opened by the shell, success toast and close, failure toast keeps it open, Cancel |
| `app/session.scene.test.ts` | Scene | 4 | 0 | not-found, Clerk loading, failed `user.me`, shell appearing as the session loads |
| `overlay/command-palette/palette.story.test.ts` | Story | 14 | 1 (B4) | opening, back stack, Escape, create/join channel, channel item + recent tracking, modal hand-off, theme, status |
| `shell/shell.story.test.ts` | Story | 11 | 2 (B2) | user menu OutMessages, org switcher (desktop and mobile), sidebar sheet, context rebuilds |

Helper: `src/test/root-fixtures.ts` (`ada`, `hazelOrg`, `owner`/`plainMember`, `urlOf`, `boot`, `after`, `sessionMessages`, `signedIn`, `signedInShared`, `rootScene`).

Additive exports for tests (no behavior change): `ui/command-menu-view.ts` `PortalCommandMenu`; `ui/toast.ts` `StartTimer`, `WaitForLifetime`, `WaitForRemoval`; `overlay/modal/create-section.ts` `Message`, `CreateSection`.

Not covered yet: the other 19 modals individually, `platform/presence` beyond the existing story, `data/live-query` (needs a TanStack DB fixture), the search page of the palette (ProseMirror Mount).
