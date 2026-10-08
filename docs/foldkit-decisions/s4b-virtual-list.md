# S4b: @foldkit/ui VirtualList for the chat list

Status: **evaluated, not adopted** · 2026-10-08 · Branch `fk/foldkit-167` (experiment on `fk/foldkit-167-virtuallist`, commit `1ac2fb6da`, not for merge)

Question: Foldkit 0.167's VirtualList now has measured dynamic row heights, stable-key viewport anchors, initial and programmatic scroll targets (Index, Key, Offset, End with alignment) and an end behavior (`Follow { thresholdPx }` or `PreserveAnchor`). Can it replace `mount/message-list.ts` and `mount/message-list-pool.ts` (S4 and the final-polish LegendList pool)?

## Answer

No, not without changes to VirtualList itself. It covers the scrolling behaviors on paper, but its view hardcodes the DOM shape and the windowing strategy. Those are exactly what the parity harness checks and what made the heavy channel run at 60fps. The integration was built and measured (below), and it turned 12 known chat failures into 65. Recommendation: keep the custom list. Revisit only if VirtualList gets the hooks listed under "What VirtualList would need".

## Requirement by requirement

| Requirement | VirtualList 0.167 | Notes |
| --- | --- | --- |
| Bottom anchoring on load | Yes | `initialScroll: { target: End }` plus `contentAlignment: "End"` (a leading inset for short channels). |
| Prepend older history without a jump | Partly | `informItemsChanged` keeps a `Row { key, viewportOffset }` anchor. But it bumps `layoutVersion`, which drops every in-flight measurement and re-measures every rendered row, and the anchor is restored in absolute `scrollTop` from DOM rects. Measured: the anchored row moved up to **112 px over 94 frames** during a 2,240 px prepend. The custom list moves it 0 px. |
| Follow new messages | Yes | `followEnd: { thresholdPx: 1 }`. Switching to `PreserveAnchor` while the capped window is slid back works by editing `endBehavior` in the Model. |
| Jump to message / permalink | Yes | `scrollToKey(model, key, { alignment: "Center" })`. The custom list has no jump yet, so this is the one real gain. |
| Dynamic heights, late images and embeds | Yes, with drift | A ResizeObserver on every measured row, then `MeasuredRows`, then reconcile. Heights are not rounded like LegendList's `updateItemSize`, and rows flow in normal layout instead of absolute offsets. `chat-attachments` moved 287 px and lost 19 % of its pixels. |
| DOM order and structure vs legacy | **No** | The container is always a `ul role=list`. Rows always get `role=listitem`, `aria-setsize` and `aria-posinset`, plus spacer `li role=presentation`, in index order. Only the row tag (`rowElement`) and the container attributes can be changed. Legacy (LegendList) renders role-less `div` containers in container-pool order and keeps recycled rows in place, so the ARIA tree and the structural pairing cannot match. |
| Pinned date divider | **No** | There is no sticky-header support. A divider inside an in-flow `li` cannot stick past its own row. The experiment drew the active divider as an `aria-hidden` sticky overlay next to the list. |
| 60fps on the 10k-message dataset | **No** | The window is recomputed on every render with a row-count overscan (default 5), so a row subtree is inserted or removed almost every scroll frame. On the heavy page each insertion pays the shared stylesheet's page-wide restyle (S4's first gotcha). The custom list moves its overscan window in 2,400 px chunks for exactly this reason. Every scroll event also reads `getBoundingClientRect` on the rendered rows to find the anchor. |
| Rows in DOM | Fewer (25 vs 210 max) | Fewer rows, but the cost is per insertion, not per row held. |

## Measured (experiment branch, static parity builds, port base 8200)

Parity, `--filter chat --strict-a11y` (115 variants):

| Build | Identical | Pass | Fail | Fails with perceptual px | Variants with extra `list`/`listitem` | Behavior diffs |
| --- | --- | --- | --- | --- | --- | --- |
| Custom list (upgrade only) | 30 | 73 | 12 (all known burndown-4 items, 0 px) | 0 | 0 | 0 |
| VirtualList | 29 | 21 | **65** | **38** | **58** | 5 (`chat-date-separators`: the scenario's `scrollIntoViewIfNeeded` on the oldest message timed out because the row was not rendered) |

Typical evidence lines from `.parity/runs/vl-chat/summary.md`:
- `chat-channel`: extra `list "Thu Mar 12 2026GGrace Hopper12:00..."`, extra `listitem "AAlan Turing12:04..."`, 18 perceptual px at the pinned divider overlay.
- `chat-embeds-gif`: extra `presentation ""` (the spacer), `listitem "Thu Mar 12 2026"`, divider moved dy=-43.
- `chat-attachments`: rows moved dy=286.9 (unrounded measured heights in flow), 251,967 perceptual px.
- `composer-empty`'s `user.me` count diff does not touch the list and looks like load noise.

Bench, `src/bench/chat-list.ts --targets foldkit` (heavy #firehose, 3 runs, 6 s, 40 px per frame). Both columns were measured on the same machine during the same session.

| Metric | Custom list | VirtualList |
| --- | --- | --- |
| up (paging) p50 / p95 | **16.7 / 16.8 ms** | 83.3 / 83-100 ms |
| down (loaded) p50 / p95 | **16.7 / 16.8 ms** | 66.7 / 83.4 ms |
| frames > 20 ms (up / down) | **2.5 / 0.3 %** | 71 / 58 % |
| blank frames | **0** | 1-7 % |
| long tasks per 6 s (up / down) | 7 / 1 | 65 / 64 |
| px covered in 6 s (up) | **12,900** | 3,800 |
| rows in DOM (max) | 210 | 25 |
| prepend anchor max movement | **0 px** (0 frames > 1 px) | 112 px (94 frames > 1 px) |
| first row | 1,250-1,290 ms | 1,150-1,270 ms |

## What VirtualList would need

1. A row render hook (or at least control of the container and row tag, role and ARIA attributes), so a list can stay role-less when the design it mirrors is.
2. A windowing policy: overscan in pixels and a hysteresis or chunk rule, so most scroll frames change no DOM.
3. Sticky headers (an index set plus the active one), or a slot rendered inside the scroller.
4. Relative (`By`) anchor corrections computed from the layout instead of absolute `scrollTop` from DOM rects, and no blanket re-measure on every item change.

Items 2 to 4 are general improvements worth proposing upstream. Item 1 conflicts with VirtualList's goal of correct list semantics by default, and Hazel only needs it because the legacy baseline is role-less.

## Other long lists

Only two legacy lists are virtualized: the chat list (LegendList) and the emoji picker (frimousse, which the Foldkit port already reproduces DOM-for-DOM with its sticky category headers). Member lists, the channel browser, command palette results, combo boxes and select popovers render every item in legacy. Virtualizing them in Foldkit would drop off-screen items from the ARIA tree and change the DOM, which fails strict parity, and none of them is long enough in the fixtures to need it. None were converted.

## 120fps budget (8.33 ms per frame), custom list

Headless rAF is capped at 60 Hz, so the per-frame main-thread cost was measured from a DevTools trace (`toplevel` tasks between consecutive `FireAnimationFrame`s). Chromium ran with `--disable-frame-rate-limit --disable-gpu-vsync`, the heavy #firehose was scrolled 40 px per frame for 300 frames each way, and the build was the merged `fk/foldkit-167` tree. The probe was a one-off script outside the repo; the perf suite on `fk/perf` owns the permanent version.

| Direction | Main-thread busy per frame p50 / p95 / p99 | Frames over 8.33 ms | Avg script / style / layout per frame |
| --- | --- | --- | --- |
| up (paging) | 0.24 / 1.26 / 95.7 ms | 1.2 % | 1.43 / 0.14 / 0.89 ms |
| down (loaded) | 0.23 / 1.14 / 6.4 ms | 0.9 % | 0.15 / 0.01 / 0.56 ms |

Steady-state scroll frames fit the 120fps budget many times over. The frames that miss it are the ones that insert an overscan chunk (one per 2,400 px) or land an older page. Each insertion pays the page-wide restyle from S4's first gotcha, and each page load re-derives the loaded rows. Making 120fps hold means making insertion cheap (spreading a chunk over idle frames or pre-rendering it off-screen, and fixing the expensive shared `:has()` selectors) rather than changing the list's anchoring. VirtualList would make this worse: it inserts on almost every frame.
