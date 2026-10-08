# Foldkit review: chat area

Scope: `apps/web-foldkit/src/{chat,composer,editor,mount,emoji-picker,gif-picker,picker-popover}` and
`src/page/{chat,chat-index}` (channel page, Files tab, thread panel, overlays, chat index).
Reviewed against Foldkit 0.167.0 docs: [Architecture](https://foldkit.dev/core/architecture),
[Testing](https://foldkit.dev/testing), [Story](https://foldkit.dev/testing/story),
[Scene](https://foldkit.dev/testing/scene),
[Project organization](https://foldkit.dev/patterns/project-organization),
[Subscription organization](https://foldkit.dev/patterns/subscription-organization).

Every finding below was checked in code. Findings marked "test" have a Story, Scene or gate test
that pins them (`test.fails` where the behavior is a bug). Paths are relative to `apps/web-foldkit/src`.

## Summary

| # | Severity | Finding | Test |
| - | -------- | ------- | ---- |
| 1 | Bug | Message list keeps a stale `scrollTop` after the Files tab round-trip | `read.story.test.ts` (fails) |
| 2 | Bug | AI replies in the thread panel never open their actor connection | `subscription.test.ts` (fails) |
| 3 | Bug | Image viewer Download / Copy URL / Open in browser are unwired and unlabeled | `messages.scene.test.ts` (fails) |
| 4 | Bug | Typing indicator is not deleted when the thread panel closes or the channel is left | `read.story.test.ts` (fails, thread case) |
| 5 | Bug | Image viewer state outlives its message; the hover toolbar then never hides | `read.story.test.ts` (fails) |
| 6 | Bug risk | Rivet live stream: `Effect.promise` defects, floating `getState()`, one merged stream for all replies | none (needs a runtime) |
| 7 | Architecture | View is not pure: `Date.now()` in the profile popover, module caches mutated during render | none |
| 8 | Architecture | Module-level mutable state (`let` memo slots, editor registry, row memo maps) | none |
| 9 | Architecture | Parent writes the Overlays Submodel's `thread` field directly | covered by thread stories |
| 10 | Architecture | Editor Mount ignores the Model's draft; `markdown` / `isEmpty` are write-only mirrors | none |
| 11 | Architecture | String-built chat URLs instead of the typed router | none |
| 12 | Convention | Inline casts, hand-rolled `deepEqual`, raw `fetch` + unchecked JSON in emoji data | none |
| 13 | Convention | `handleOverlaysOut` is an `if` chain over action strings; navigation lives in `index.ts`, not `update` | none |
| 14 | Convention | `write.ts` and `page.ts` import each other | none |
| 15 | Convention | Unbounded per-visit growth: `measuredHeights`, `unfurls`, `pickerDataOf` cache | none |
| 16 | a11y | Attachment images are click-only `<img>`; picker overlays nest inside the trigger `<button>` | scene notes |

## Fix now, low risk

### 1. Message list keeps a stale scroll position after the Files tab (bug)

`page/chat/channel/view.ts:293` renders the list only on the Messages tab, so the Files tab unmounts it.
`setTab` (`page/chat/channel/page.ts:87`) keeps `model.list` untouched. When the list remounts,
`ObserveMessageList` (`mount/message-list.ts:455`) reports only `ResizedViewport`; `reconcile`
(`mount/message-list.ts:237`) compares the target against the Model's old `scrollTop`, finds no
difference and issues no `ApplyScroll`. The fresh element sits at `scrollTop = 0` while the pool
renders rows around the old offset (`withPool` reads `model.scrollTop`), so the viewport shows the top
of an absolutely positioned content box with no rows in it.

Rule: the Model must describe the DOM it drives ([Architecture](https://foldkit.dev/core/architecture),
Mount section: imperative state scoped to the element's life).

Fix: have the Mount report the element's real position on acquire (a `MountedList({ scrollTop,
viewportHeight })` Message, or `ScrolledList` with the initial `scrollTop` before `ResizedViewport`),
and treat it as truth in `update` so `reconcile` schedules `ApplyScroll` back to the anchor.
Pinned by `read.story.test.ts` "coming back from the Files tab restores the list's scroll position".

### 2. AI replies in the thread panel never stream (bug)

`chatLiveReplies` (`page/chat/channel/subscription.ts:89-98`) derives its ids from `model.messages`
only. Thread panel rows (`page/chat/thread-panel.ts:101-121`) run the same `messageRowData`, so an AI
reply in a thread renders the idle "Thinking" block and never receives `TextChunk` events. Legacy
`ThreadMessageItem` renders `Message.Content`, whose `MessageEmbeds` mounts `MessageLive.Provider`
and connects. Fix: `connectedMessageIds([...model.messages, ...model.threadMessages])` (memoized on
both arrays). Pinned by `subscription.test.ts` "an AI reply streaming in the open thread panel opens
its actor connection".

### 3. Image viewer actions are dead (bug, a11y)

`chat/image-viewer.ts:183-191` builds Download, Copy URL and Open in browser from the optional
`toAction` input. The only caller, `page/chat/channel/view.ts:126`, never passes it, so the three
toolbar buttons render with no handler and no accessible name (icon-only, no `aria-label`; the close
button has no name either). Legacy downloads, copies with a toast, and opens a tab.

Fix: add `ClickedViewerAction({ action, url })` to `Overlays.Message`, raise it as an OutMessage, and
run `DownloadImage` / `CopyText` / `OpenUrl` Commands in `write.ts`; give every toolbar button an
`aria-label` ("Download", "Copy image URL", "Open in browser", "Close"). Pinned by
`messages.scene.test.ts` "the viewer's Download action is labeled and wired".

### 4. Typing indicator outlives the thread panel and the channel (bug)

`page/chat/channel/write.ts:288-294` (`syncThreadDraft`) drops `threadDraft` when the panel closes
without running `Typing.stop`, so no `DeleteTypingIndicator` is issued. Legacy `useTyping`
(`apps/web/src/hooks/use-typing.ts:262-266`) deletes the indicator on unmount. The same happens when
the user switches channels: the page contract (`page/contract.ts:53-63`) has no hook that runs when a
page instance is dropped, so the channel draft's indicator is never deleted either.

Fix (thread, low risk): in `syncThreadDraft`, when the draft goes away, lift
`Typing.stop(threadDraft.typing)` and return its Commands. Fix (channel): add an `exited(model,
shared)` hook to `PageSpec` that the root calls when it drops a page slot and that may return
Commands; the channel page returns the stop Commands of both drafts. Pinned for the thread case by
`read.story.test.ts` "closing the thread panel while typing deletes the thread's typing indicator".

### 5. Image viewer outlives its message (bug)

`Overlays.imageViewer` (`page/chat/overlays.ts:329-335`) is only cleared by `ClosedImageViewer`. When
the message leaves the window (deleted, or the window slid), `imageViewerOverlay`
(`page/chat/channel/view.ts:121-124`) renders nothing, the user cannot close it, and
`PointerLeftList` (`overlays.ts:214-219`) keeps returning early because `imageViewer !== null`, so the
hover toolbar never hides again on that page.

Fix: in `deriveRows` (`page/chat/channel/page.ts:138`), clear `overlays.imageViewer` (through an
Overlays function, see finding 9) when its `messageId` is no longer in `rows`. Pinned by
`read.story.test.ts` "the viewer closes when its message leaves the window".

### 7. View purity

- `page/chat/row-context.ts:152` passes `nowMs: Date.now()` to the profile popover from the view.
  [Architecture](https://foldkit.dev/core/architecture): view renders the Model, nothing else. Use
  `shared.nowMs` (already on `Shared`) or a clock in the Model like `typingNowMs`.
- `page/chat/channel/view.ts:27-45` mutates `rowSlots` / `renderedThisFrame` while rendering and prunes
  them as a side effect of `view`. Rendering the same Model twice (DevTools time travel, a Scene)
  changes module state. Move per-row memoization into Foldkit primitives (`createLazy` per keyed row
  inside `MessageList.view`, keyed by row key, owned by the list) or keep the map but never prune it
  from `view` (prune from `update` when keys change).

## Needs a design change

### 6. The Rivet AI stream as a Subscription (bug risk, architecture)

`chat/live-state.ts:190-210` and `page/chat/channel/subscription.ts:89-98`:

- `Effect.promise` around the dynamic import, `getAccessToken()` and `connect()` turns any rejection
  into a defect. The connections are one `Stream.mergeAll`, so one failed token fetch kills every live
  reply's stream and no `Failed` event reaches the Model (legacy shows the actor error on the row).
- `connection.getState().then(...)` is a floating promise: a rejection is unhandled, and it can
  resolve after release and offer into a shut queue.
- The dependency is the whole id list, so a new AI reply in the window tears down and reconnects every
  other streaming reply (each reconnect re-fetches the snapshot).
- `liveIdsCache` (`subscription.ts:49`) is a module-level `WeakMap` memo.

This is the case [ManagedResources](https://foldkit.dev/core/architecture) exist for: a stateful
handle that lives while a Model slice holds a value, with typed lifecycle Messages and
`ResourceNotAvailable` when absent. Suggested shape: model the connection set in the Model
(`liveConnections: Record<MessageId, "Connecting" | "Open" | "Failed">`), acquire one handle per id
with `Effect.tryPromise` mapped to a typed `LiveConnectionError`, emit `FailedLiveConnection` into the
row's state, and read events through a Subscription keyed per id (or `persistentEntry`) so adding an
id does not restart the others.

### 8. Module-level mutable state

- `mount/message-list.ts:118-142, 163-171, 297-310`: three single-slot `let` memos (`layoutOf`,
  `stickySetOf`, `stickyIndexesOf`). They are keyed by reference so they are correct, but the channel
  list and the thread panel would thrash one slot, and they violate the no-`let`-state rule. Store the
  derived layout in the list Model (recomputed in `update` when `keys` or `measuredHeights` change) or
  memoize with a `WeakMap` keyed by `model.keys`.
- `page/chat/composer-view.ts:11` (`lastReply`) is shared by the channel and thread drafts, which defeat
  each other's memo; `page/chat/row-context.ts:166-189` (`idleCache`) stores a `Cache<M>` as
  `Cache<never>` with a cast to get around variance.
- `editor/editor-view.ts:119-125`: the `editors` registry is how Commands reach the ProseMirror view.
  Commands that run while no editor is registered silently do nothing (`composer/composer.ts:243-247`),
  for example a failed send's `SetEditorContent` after the user switched to the Files tab. A
  ManagedResource keyed on `editorId` would make "no editor" an explicit `ResourceNotAvailable` the
  update can handle (re-apply the content on the next `MountEditor`).

### 9. Parent reaches into the Overlays Submodel

`page/chat/channel/write.ts:146-152` (`openThread`) and `write.ts:246-256` (`FailedCreateThread`) write
`model.overlays.thread` directly; the thread panel's lifecycle is therefore split between
`Overlays.update` (`ClickedThreadPreview`, `ClosedThread`) and the page. Rule:
[Submodels](https://foldkit.dev/core/architecture) own their state; parents talk to them through
their API. Either move `thread` out of `Overlays` into the page Model (it is page state: it drives
subscriptions and the thread draft), or expose `Overlays.openThread` / `Overlays.closeThread`
functions and call those.

### 10. The editor Mount does not read the Model

`MountEditor` (`composer/composer.ts:172-209`) always creates an empty document. `Composer.Model`
mirrors `markdown` and `isEmpty` from `UpdatedDraft`, but nothing reads them (`grep` finds only the
writes in `composer/update.ts:71`). After the Files tab round-trip the editor is empty while
`Draft.typing.lastContent` still holds the old text. Either drop the mirrors, or pass the draft's
markdown as a Mount arg (initial content only, not a reactive arg) so the Model is the source of
truth for what the editor shows.

### 11. String-built URLs

`page/chat/channel/page.ts:97-98` (`tabPath`), `page/chat/files/media-view.ts:19`,
`page/chat/header.ts:58` and `page/chat-index/cards.ts:27` build chat URLs with template strings.
`route.ts:120-130` defines the routers inline in `orgRouters` and does not export them; Foldkit
routers have `.build` ([Routing](https://foldkit.dev/core/architecture)). Export named routers
(`chatChannelRouter`, `chatFilesRouter`, `chatFilesMediaRouter`) and build hrefs from route values.

## Conventions

### 12. Casts and unchecked data

- `page/chat/data.ts:79`: `order as ReadonlyArray<MessageId>`. Decode with `Schema.Array(MessageId)`
  or brand at the collection boundary.
- `page/chat/rows.ts:139-153`: a hand-rolled `deepEqual` with `as Record<string, unknown>` casts. Use
  `Schema.toEquivalence(ChatMessage)`.
- `composer/composer.ts:188, 216`: `element as HTMLElement`; `message-list.ts` already uses an
  `instanceof HTMLElement` guard, use it here too.
- `emoji-picker/data.ts:76-81, 111, 121`: native `fetch` + `response.json() as A` and two
  `as EmojiData["skinTones"]`. Use `HttpClient` + `HttpClientResponse.schemaBodyJson` as `chat/unfurl.ts`
  does; `localStorage.setItem` inside the Effect can throw (quota) and becomes a defect.
- `page/chat/channel/view.ts:208`: `cached as (message: Draft.Message) => M`.

### 13. Control flow

- `page/chat/channel/write.ts:196-216`: `RequestedMessageAction` is an `if` chain over the
  `MessageAction` literals with a silent fallthrough to "add-reaction". Use `Match.value(action).pipe(
  Match.when(...), Match.exhaustive)` so a new action is a compile error.
- `page/chat/channel/index.ts:34-45`: `ClickedTab` and `ClickedMobileMenu` are handled in the page
  definition while `update` returns a no-op for them (`page.ts:225, 279`). Story tests on `update`
  cannot see the navigation. `update` already receives `shared` and returns `PageReturn`; emit the
  OutMessages there.

### 14. Import cycle

`page/chat/channel/write.ts:28` imports `resetWindow` from `page.ts`, which imports `* as Write`. Move
`resetWindow` / `withWindowFollow` to a small `window.ts` both import.

### 15. Unbounded per-visit growth

`list.measuredHeights` (`mount/message-list.ts:387-393`), `model.unfurls` (`page/chat/channel/page.ts:119-135`)
and `pickerDataOf`'s per-search cache (`emoji-picker/data.ts:215-249`) only grow. A long session in a
busy channel keeps every row height and unfurl ever seen. Prune `measuredHeights` and `unfurls` to the
current window's keys in `deriveRows`; cap the picker cache (or keep only the last search).
`FetchLinkPreview` / `FetchTweet` (`chat/unfurl.ts:230-261`) have no timeout, so a hung worker leaves
a row in `Loading` for the visit; add `Effect.timeout`.

### 16. Accessibility notes

- Attachment images (`chat/attachments.ts:51-56`) open the viewer from `OnClick` on a bare `<img>`: not
  focusable, no keyboard path. Wrap in a `<button aria-label="Open <file>">`.
- Picker overlays (`picker-popover/popover.ts:110-121`) and the toolbar's menus render the dialog as a
  VNode child of the trigger `<button>`; the portal Mount moves it to `<body>` at runtime. Until then
  the button's accessible name includes the whole picker, and in Scene a click inside the picker
  bubbles to the trigger and reopens it (the emoji scene test closes with Escape for that reason).
  Render the overlay as a sibling of the trigger.
- Nucleo icons render a `<title>`, so icon-plus-text buttons are named "<icon title> Emoji". Mark
  decorative icons `aria-hidden` (UI kit, flagged for the kit owner).

## What is already good

- `mount/message-list.ts` keeps all scroll logic in `update`: the Mount only reports scroll, viewport
  and row sizes, and `ApplyScroll` writes `scrollTop` after `Render.afterCommit`. Versioned
  `ApplyScroll` / `WaitForScrollSettle` make stale results no-ops. No measurement leaks into `update`.
- Every Mount in the area (`ObserveMessageList`, `MountEditor`, carousels, portal, toolbar, drop zone,
  pickers) uses `Effect.acquireRelease` and releases listeners, observers and embla instances. The
  editor and list Mounts follow `viewStateChanges` for DevTools history.
- Typing (`composer/typing.ts`) is a clean state machine: timers are interruptible Commands, a session
  id drops late heartbeats, versions supersede stale timeouts.
- Subscriptions are gated on Model slices: the typing clock only runs while someone types, uploads
  only while a file is current, thread membership only while a thread is open, the files lift reads
  `Option` of `model.files`.
- Change sets (`applyMessageChanges`, `shareMessages`, `shareKeys`) keep references stable so an
  unchanged window costs nothing downstream.
- Unfurls are deduplicated by key and remembered on failure; the GIF picker drops stale responses by
  `requestId`.
- Draft, Overlays and Composer communicate upward through OutMessages (`RequestedToast`,
  `SentMessage`, `RequestedMessageAction`, `RequestedReaction`). Messages are past-tense facts
  throughout; Commands are verb-first.

## Tests added

| File | Kind | Tests |
| ---- | ---- | ----- |
| `composer/composer.story.test.ts` | Story | 11 passing |
| `composer/draft.story.test.ts` | Story | 19 passing |
| `page/chat/channel/read.story.test.ts` | Story | 15 passing, 3 `test.fails` (findings 1, 4, 5) |
| `page/chat/channel/messages.scene.test.ts` | Scene | 9 passing, 1 `test.fails` (finding 3) |
| `page/chat/channel/subscription.test.ts` | Subscription gates | 4 passing, 1 `test.fails` (finding 2) |
| `page/chat-index/scene.test.ts` | Scene | 3 passing |

Helpers: `src/test/chat-messages.ts` (message, live-embed and image-attachment builders, no view
imports) and `src/test/chat-fixtures.ts` (channel Scene config, wrapped Message constructors,
`mountedChannel` and `mountedToolbar` steps that resolve the first-render Mounts). Both build on the
existing `page/chat/channel/fixtures.test-support.ts`.

Scene notes for future tests: Mounts attached with `Mount.mapMessage` need the parent-wrapped Message
in `Mount.resolve`, while Mounts inside `h.submodel` (tooltips, menus) take the child's raw Message;
menu triggers and tabs open on `pointerDown`, not `click`; `keydown` does not bubble in Scene, so send
it to the element that owns the handler.
