# S4: Chat list spike

Status: **passed (desktop)** · 2026-10-07 · Branch `fk/s4-chat-list`

Question: can Foldkit render the channel screen pixel-identical to legacy with a bottom-anchored, virtualized message list that scrolls at 60fps through a 10k-message channel, keeps its position when older messages are prepended, and sticks to the bottom when a new message arrives?

## Result

Parity, `chat-channel` (`/hazel/chat/<general>`, default dataset):

| Variant        | Status   | Perceptual px | Strict px | Structural deltas | Console errors |
| -------------- | -------- | ------------- | --------- | ----------------- | -------------- |
| desktop, light | **pass** | **0**         | 72        | **0**             | none           |
| desktop, dark  | **pass** | **0**         | 55        | **0**             | none           |
| mobile, light  | fail     | 2157          |           | mobile shell      | none           |
| mobile, dark   | fail     | 1708          |           | mobile shell      | none           |

- Desktop: every strict pixel is a ±1 (once ±2) channel difference on the anti-aliased corners of the facehash avatars (the left and right edges of each 40px message avatar at x=368/407, and the DM avatar in the sidebar). That is the compositor noise S1 recorded; legacy-vs-legacy guard runs show the same pattern. Boxes, computed styles and text runs are identical, the message area included.
- Mobile needs the mobile shell, which is Phase 2 and not ported: the bottom `MobileNav` (Menu, Home, Messages, Activity, Settings), the header's menu button (`isMobile` in `ChatHeader`, which shifts the title 40px), and the sheet sidebar. The message list itself renders at 390px; the remaining structural record is the `main` landmark's text, which starts with the menu button in legacy and with the first rendered row in Foldkit.
- Other chat scenarios in run `fk-final`: `chat-heavy-channel` (the virtualized 10k-message #firehose, light and dark), `chat-heavy-small-channel`, `chat-channel-empty` and `chat-private-channel` all **pass with 0 perceptual pixels** (strict pixels only on facehash corners). Still failing, all outside S4: `chat-dm` (DM header), `chat-message-hover` (hover toolbar), `chat-composer-focused` (S3) and `chat-files-tab` (route not ported).

Scrolling and anchoring, heavy dataset (#firehose, 10,000 messages), static parity builds, Chromium headless, 1440×900, rAF frame-time probe while scrolling programmatically (`packages/ui-parity/src/bench/chat-list.ts`, 3 runs × 6 s each direction, 40 px per frame):

| Target                         | Pass         | p50 frame      | p95 frame        | p99       | frames > 20 ms | blank frames | long tasks / 6 s | first row  | JS heap   |
| ------------------------------ | ------------ | -------------- | ---------------- | --------- | -------------- | ------------ | ---------------- | ---------- | --------- |
| legacy (pinned `0126176e0`)    | up, paging   | 83.3 ms        | 333 ms           | 500 ms    | 58 %           | 1.7 %        | 32 (5.3 s)       | 1,071 ms   | 225 MB    |
| legacy (pinned)                | down, loaded | 16.7 ms        | 100-150 ms       | 167 ms    | 11 %           | 0            | 22 (2.8 s)       |            | 228 MB    |
| legacy-head (with the CSS fix) | up / down    | 83.3 / 16.7 ms | 333 / 100-150 ms |           | 60 / 11 %      | 1.7 / 0 %    | 32 / 22          | 1,078 ms   | 225 MB    |
| **Foldkit**                    | up, paging   | **16.7 ms**    | **16.8-33 ms**   | 83-100 ms | **5 %**        | **0**        | 14 (1.3 s)       | **581 ms** | **48 MB** |
| **Foldkit**                    | down, loaded | **16.7 ms**    | **16.8 ms**      | 83 ms     | **1.7 %**      | **0**        | 5 (0.5 s)        |            | 41 MB     |

Medians across the 3 runs; each run is a fresh page. "up" starts at the bottom and pages older messages in as it reaches the top (Foldkit scrolled 12,000 px per run, legacy 2,360 px because its frames are slower); "down" goes back through what was loaded.

Prepend anchoring (`measurePrependAnchor`: pick the message under a probe, scroll into the load-older threshold, hold still while the older page lands, track the row every frame):

| Target      | Prepended | Max anchor movement | Frames moved > 1 px                              |
| ----------- | --------- | ------------------- | ------------------------------------------------ |
| legacy      | 1,968 px  | 24 px               | 1 (and 1 frame where the row was not in the DOM) |
| **Foldkit** | 2,060 px  | **0 px**            | **0**                                            |

New message and reaction toggle through Electric (fixture live events, `--live`, 10 pushes × 3 runs, reader at the bottom):

| Target      | New message shown (p50 / p95) | Stuck to bottom | New message fully visible | Reaction add / remove shown (p50) |
| ----------- | ----------------------------- | --------------- | ------------------------- | --------------------------------- |
| legacy      | 707 / 928 ms                  | 30/30           | 30/30                     | 1,600 / 767 ms                    |
| **Foldkit** | **59 / 182 ms**               | **30/30**       | 29/30                     | **321 / 245 ms**                  |

Both run the same Electric client and collections; the latency includes the fixture's long-poll and the collection update. Deep stress (20 s at 250 px per frame, paging continuously): Foldkit p50 16.7 ms, p95 100 ms, 157k px covered; legacy-head p50 233 ms, 19k px covered.

## How the list works

`apps/web-foldkit/src/mount/message-list.ts` replaces `@legendapp/list`:

- **Absolute rows from measured heights.** The Model holds the row keys, measured heights (an estimate until measured) and the scroll state. The view computes prefix sums once per (keys, heights) pair, renders the rows between two keys the Model keeps (see chunks below), and renders each row absolutely positioned at its offset inside a container of the total height, the same structure LegendList produces (`contain: layout style paint` wrappers, a flex column with `justify-content: flex-end` so short channels sit at the bottom). A newly rendered row is placed at its estimated offset, so its real height never moves rows already on screen.
- **One container Mount** (`ObserveMessageList`, `Mount.defineStream`) owns the scroll listener, a ResizeObserver for the viewport and one ResizeObserver for every rendered row (a MutationObserver keeps the observed set in sync). It reports `ScrolledList`, `ResizedViewport` and batched `MeasuredRows` Messages.
- **Anchoring in `update`.** The Model keeps a `ViewportAnchor`: `End` while the reader is within 1 px of the bottom, otherwise `Row { key, viewportOffset }` for the top visible message. Whenever keys or heights change (`setKeys`, `MeasuredRows`, `ResizedViewport`), `update` recomputes where `scrollTop` must be for the anchor to stay put and returns `ApplyScroll`: `To` the end when following, `By` the anchor's shift otherwise. The Command waits for `Render.afterCommit`, so the scroll is written after the patch and before the browser paints, in the same frame.
- **Prepend** is the window growing by a page when the reader is within half a viewport of the top (LegendList's default threshold). The prepended rows land above the anchor at estimated heights, `By` shifts the scroll by exactly that, and when the new rows are measured a second `By` absorbs the estimate error. Both happen in frames where the anchored row does not move.
- **Stick to bottom**: a new message changes the keys while the anchor is `End`, so `update` returns `To` the new end.
- **Date dividers** are rows; the one above the viewport renders `position: sticky` at the end of the container (as LegendList does) and loses its line (`isStuck`).
- **Rows are inserted in chunks.** The rendered range is two row keys in the Model. `update` only moves it when the viewport comes within 200 px of its edge, and then renders 2,400 px past the viewport, so most scroll frames change no DOM at all (about 80 rows in the DOM).
- **Rows render through a per-row `createLazy` slot**, created on demand and dropped when the row scrolls far away (`createKeyedLazy` never evicts, which is wrong for 10k rows). Rows are derived once per data change in `update` (`page/chat/rows.ts`), with unchanged messages and rows keeping their object identity, so cache hits are reference checks.

The message viewer (`page/chat/markdown-view.ts`) is a pure view: the legacy `deserializeFromMarkdown`, the legacy decorators and Slate's own `Text.decorations` (through `slate-message-viewer-model.ts`, framework-free) produce the same leaves and classes a read-only Slate `Editable` renders, with no editor instance per message.

## What was proven

- **Pixel parity of the channel screen** on desktop in both themes: header, tab bar, message rows (grouping, date divider, bullets, inline code, the bold-plus-italic `**#412**` case, reactions), composer box, and (ported by a helper agent) the full chat sidebar.
- **Virtualization at 60fps.** Foldkit holds 16.7 ms p50 in both directions with no blank frames, against legacy's 83 ms p50 while paging. The remaining long frames are the frames that insert a chunk of rows (see the first gotcha), about one per 2,400 px scrolled.
- **Prepend keeps position to the pixel**: in every run the anchored row moved 0 px through a 2,354 px prepend, on every frame. Legacy jumps 24 px for one frame on the same probe.
- **Sticks to the bottom** on a new message: Story tests, and end to end with the new fixture live events: the list followed 30 of 30 pushed messages (legacy too), and showed them 12× sooner than legacy (59 ms vs 707 ms p50).
- **Update logic is testable without a DOM**: `apps/web-foldkit/src/page/chat/page.test.ts` (7 tests) covers starting at the end, prepend anchoring with estimated then measured heights, the divider-at-the-top case, stale scroll events while a correction is pending, sticking to the bottom, not moving a reader who scrolled up, and requesting an older page near the top.

## Gotchas found (each one is now encoded in code or the harness)

| Gotcha                                                                                                                                                                                                                                                                                                                                             | Fix                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On the heavy workspace any frame that inserts a message subtree costs ~75 ms of style and layout, in both apps: the shared stylesheet's `:has()` rules (avatar, icon, description, intent families; no single rule) make Chrome restyle all ~23k elements. LegendList hides it by recycling containers; per-frame windowing made Foldkit 83 ms p50 | The rendered range moves in 2,400 px chunks (above). Making the legacy `:has()` utilities cheaper would help both apps and is worth a separate legacy pass        |
| A date divider at the very top makes a useless anchor: it stays first when older same-day messages are prepended, so nothing moved and pages loaded in a loop (5,000 messages in seconds)                                                                                                                                                          | Dividers are passed as `stickyKeys` and never anchor                                                                                                              |
| Absolute `scrollTop` corrections overwrite whatever the reader scrolled while the correction was in flight                                                                                                                                                                                                                                         | Row-anchor corrections are relative (`By`); the anchor is re-read from the real `scrollTop` when the correction lands                                             |
| A scroll event that arrives after `update` changed the layout but before the patch describes the old DOM                                                                                                                                                                                                                                           | Scroll events are ignored while an `ApplyScroll` is pending                                                                                                       |
| Story refuses a Message while Commands are pending, so that race cannot be written as a Story                                                                                                                                                                                                                                                      | The race test drives `update` directly                                                                                                                            |
| Foldkit re-runs the whole view for every Message; a scroll frame rebuilt the 500-channel sidebar                                                                                                                                                                                                                                                   | The sidebar, header, tab bar and composer stand-in are memoized with `createLazy`; child `toParentMessage` functions live at module scope so lazy args stay equal |
| `.has-disabled:opacity-50:has(:where(:not([data-rac])):disabled)` (from `input-otp.tsx`, not even on the page) made Chrome restyle all ~23k elements of the heavy page on every DOM insertion: 85 ms style + 80 ms layout per inserted row, in **both** apps                                                                                       | `has-[input:disabled]` in `input-otp.tsx` (legacy-head vs legacy: identical 24, pass 2). `src/bench/style-bisect.ts` finds such rules                             |
| Every Message constructor validates its payload; tagged-union constructors do too                                                                                                                                                                                                                                                                  | Derived rows are built as plain literals                                                                                                                          |
| Subscription keys share one namespace across `Subscription.aggregate` (a sidebar `presenceClock` crashed the app)                                                                                                                                                                                                                                  | Child keys are prefixed                                                                                                                                           |
| macOS ControlCenter (AirPlay Receiver) listens on port 5000                                                                                                                                                                                                                                                                                        | This worktree used `PARITY_PORT_BASE=5750`                                                                                                                        |

## Not done in S4 (by design)

- Mobile layout (needs the Phase 2 mobile shell).
- Hover toolbar and context menu (`chat-message-hover`), replies, thread previews, attachments, embeds and link previews, code blocks, mentions and custom emoji in the viewer (they render as plain paragraphs today), the "new messages" highlight, scroll-to-message, the typing indicator: Phase 3.
- The composer is a static stand-in with the legacy boxes and roles (S3).
- Bounding the loaded window: pages only grow, and each page load re-derives every loaded row (see S2). In the deep stress the page loads past a few hundred messages become long tasks again (O(loaded rows) per load).

## Next

- Phase 3 can build on `mount/message-list.ts` as is; the thread panel should get its own list instance.
- Cap the loaded window and emit change sets (S2 conditions), then re-run the deep-scroll stress.
- Port the mobile shell, then re-run `chat-channel --filter mobile`.
