# S2: Data layer spike

Status: **decided: keep the TanStack DB bridge (option a)** · 2026-10-07 · Branch `fk/s4-chat-list`

Question: should the Foldkit app keep Electric + the legacy TanStack DB collections and bridge live query results into the Model (a), or hold a normalized store of every synced row in the Model and update it from Electric shape changes (b)? Measured on the `heavy` dataset: 500 channels, 12,063 messages (10,000 in #firehose), 2,860 reactions, 48 users.

## Result

Bun microbenchmark (`apps/web-foldkit/scripts/bench-s2-data.ts`, medians of 15 samples, Apple Silicon). Option (a) runs the channel page's real streams (`page/chat/data.ts`: the legacy query builders behind `liveQueryStream`) against local TanStack DB collections with the legacy indexing (`autoIndex: "eager"`, BTree). Option (b) runs `src/data/normalized-store.ts`, a prototype store in the Model fed by shape change rows. "Loaded" is how many newest messages the open channel holds (the list pages in 30 at a time).

New message arriving (ms, change written → page Model updated; freeze is dev-only and listed apart):

| Loaded rows | (a) data layer | (a) update | **(a) total** | (a) freeze | (b) apply | (b) derive | **(b) total** | (b) freeze |
| ----------- | -------------- | ---------- | ------------- | ---------- | --------- | ---------- | ------------- | ---------- |
| 30          | 0.40           | 0.52       | **0.92**      | 0.26       | 1.26      | 0.08       | **1.36**      | 4.80       |
| 300         | 0.79           | 0.56       | **1.35**      | 0.40       | 1.25      | 0.29       | **1.56**      | 4.71       |
| 3,000       | 7.01           | 4.55       | **11.56**     | 2.44       | 1.15      | 2.08       | **3.25**      | 6.42       |
| 10,000      | 21.11          | 9.69       | **30.80**     | 8.94       | 1.28      | 7.30       | **8.61**      | 13.08      |

Reaction toggle (ms, median of add and remove):

| Loaded rows | (a) total | (a) freeze | (b) total | (b) freeze |
| ----------- | --------- | ---------- | --------- | ---------- |
| 30          | 1.06      | 0.79       | 0.06      | 0.34       |
| 300         | 1.16      | 0.87       | 0.29      | 0.49       |
| 3,000       | 2.90      | 2.21       | 2.34      | 2.23       |
| 10,000      | 8.44      | 6.11       | 7.27      | 7.04       |

Initial channel build, memory:

|                                                | (a) TanStack DB bridge                                           | (b) normalized store                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| First page (30 rows) ready                     | 58 ms (57 ms is the first live query, including the index build) | 32 ms (validate 11 ms + fold all 15k rows 21 ms)           |
| 10k rows in the page                           | 215 ms                                                           | 34 ms                                                      |
| Initial dev-mode freeze                        | 4.8 ms (page Model only)                                         | 10.4 ms (every synced row) to 24 ms (with 10k-row page)    |
| Heap held for one open channel (`--heap a\|b`) | 34.7 MB (collections, indexes, live queries, page)               | 2.1 MB (store + page; strings shared with the source rows) |

In the browser (static parity builds, `packages/ui-parity/src/bench/chat-list.ts`, heap after GC with the heavy channel open): legacy React **226 MB**, Foldkit with option (a) **48 MB**. Both run the same collections, so the gap is React, Slate and LegendList, not the data layer.

## What was proven

- **Option (a) runs the legacy collections unchanged in Foldkit**, including joins, `orderBy` + `limit` windows and the eager indexes, and a Bun script can drive the real data code by swapping `~/db/collections` for local collections through a loader plugin. No Electric, no browser.
- **At the sizes the UI actually holds, (a) and (b) are equal.** The list loads 30 rows per page; with 30 to 300 rows loaded a new message costs about 1 ms in both, a reaction toggle 1 ms in (a) and 0.1 to 0.3 ms in (b). Both are a small fraction of a 16.7 ms frame.
- **(a) costs O(loaded rows) per change.** A live query re-emits the whole window: TanStack's incremental view maintenance, `toArray`, mapping and Schema validation of the emitted Message all scale with it. At 3,000 rows a new message costs 11.6 ms, at 10,000 rows 30.8 ms. The S4 deep-scroll stress shows the same thing from the user's side: once thousands of messages are paged in, each page load becomes a long task.
- **(b) has a dev-mode floor.** Copy-on-write records of 12k messages mean every insert re-copies and re-freezes a 12k-key object and a 10k-id array: about 5 ms per update in dev, 13 ms with a 10k-row page. Production does no freezing, but the plan relies on dev mode catching mutation bugs.
- **(b) does not remove the O(loaded rows) part on the page.** Deriving rows (grouping, date dividers, reaction aggregation) for a 10k window costs 7 ms in both options. Making that incremental is a page concern either way.

## Gotchas found

| Gotcha                                                                                                                                                       | Fix or consequence                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every Foldkit Message constructor validates its payload with Schema (`schema.make`). `UpdatedMessages({ messages })` with 10k rows validates 10k rows (4 ms) | Keep array-carrying Messages small (window, not everything); build derived rows as plain literals, not with tagged-union constructors, in hot paths (`page/chat/rows.ts`)     |
| Live query rows are typed `any` (`QueryBuilder<any>`)                                                                                                        | The bridge types them with interfaces whose ids are already branded (the collections decode with the domain schemas), so no decode or cast is needed (`page/chat/queries.ts`) |
| Re-keying a Subscription to widen the window recreates the live query from scratch                                                                           | Fine for 30-row pages; for deep history use TanStack's `setWindow` on one live query (what `useLiveInfiniteQuery` does)                                                       |
| Bun applies tsconfig `paths` before runtime plugins' `onResolve`                                                                                             | The benchmark redirects `~/db/collections` with `onLoad` on the resolved file instead                                                                                         |
| A normalized store needs its own optimistic layer: `db/actions.ts` (970 lines) writes through TanStack DB transactions                                       | Not prototyped. With (b) every optimistic action, rollback and Electric txid wait would move into `update`                                                                    |

## Recommendation

Keep the TanStack DB bridge (§3.2 as drafted). It is as fast as a normalized store at the window sizes the chat actually holds, it keeps the Electric protocol handling and the 970 lines of optimistic actions that already work, and it keeps the deep-frozen Model small (the page holds its window; collections hold the rest). Option (b) only wins once a page holds thousands of rows, and the fix there is to bound and update the window, not to move every synced row into the Model.

Conditions that come with the decision:

1. **Cap the loaded window.** The list should keep a bounded number of pages around the viewport (dropping far pages, re-requesting them when scrolled back) instead of growing `limit` forever.
2. **Emit change sets for big windows.** `liveQueryStream` can forward `subscribeChanges` deltas (insert/update/delete with keys) instead of `toArray`, so the page applies them in O(change). Worth doing when the window cap is above a few hundred rows.
3. **Derive rows incrementally.** Grouping and date dividers only change around an inserted or removed message; recomputing them for the whole window is the same 7 ms at 10k in either option.

## What's left

- Change-set emission and a bounded window (above); then re-run the deep-scroll stress.
- End-to-end latency through Electric: the parity fixture now accepts pushed live events (`POST /__parity/push`, `packages/ui-parity/src/backend/live-events.ts`); the S4 record has the browser numbers for a new message and a reaction toggle in both apps.
- Optimistic writes (`db/actions.ts`) from Commands: Phase 4.
