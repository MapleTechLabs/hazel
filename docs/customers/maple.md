# Maple data source

Maple is Hazel's **usage source**: the product events Maple records about an app's own users become
the daily activity behind active users, usage trends, `lastActiveAt`, the champion, and the
`inactive`, `usage_drop`, `onboarding_stalled` and `champion_inactive` signals. On top of that, any
event a person maps to a metric becomes a per-account daily count a chart, a signal or the health
score can read.

It is a **custom integration**, not a product one. Maple is the product owner's own observability
product, and what makes this work is that Maple stamps its product events with _Hazel's_ identity:
`GroupId` is the Clerk organization id and `UserId` the Clerk user id
(`maple/docs/product-events-catalog.md`). So Maple never introduces a customer — it records usage on
the accounts and contacts Clerk already created. Generalizing it (other identity keys, other
warehouses) is deliberately left for later.

Implementation: `apps/backend/src/worker/objects/customers/maple/` — `adapter.ts` (connect, pull),
`http.ts` (one `run_sql` call), `pull.ts` (the day-by-day walk), `map.ts` (rows → `IngestOp`s),
`wire.ts` (the transport and the row shapes). Contracts: `docs/customers/tech-design.md` §3 and §5.

## Setting it up

1. **Create a key.** Maple → **Settings → MCP** gives a key (`maple_ak_…`) that opens the MCP tools
   and nothing else, which is the narrowest credential that can read product events; a key from
   **Settings → Keys** works too. Copy the key of the region the Maple organization is in — a key of
   one region is rejected by the other.
2. **Name the Maple organization** (`org_…`) and pick its **region** (US or EU) in the connect form.
   Connecting refuses a key that opens a different organization than the one named, so a key pasted
   from the wrong place cannot import someone else's usage under this name.
3. **Map the events you care about** under the source's settings: an activity allowlist (empty =
   every identified event counts), event → metric key mappings, and the lookback a backfill
   imports (default 90 days, 1–365). A name Hazel cannot put in a query (quotes, spaces, or `$__`,
   which Maple would expand as a macro) is skipped; an allowlist where _every_ name is skipped is
   refused when it is saved, since sending none would mean "every event counts".

There is **no webhook**: Maple sends none for a product event. The schedule is the whole signal, and
it runs **hourly**.

### Why the MCP endpoint

Maple has no public REST endpoint for product events. `/v2/...` carries resources (dashboards,
alerts, keys) and the warehouse query routes (`/internal/query-engine/*`) are session-only and
refuse API keys by design (`maple/docs/api-v2.md`, "Dashboard-only operations … raw warehouse
queries"). The one documented, key-authenticated way in is Maple's **MCP server** —
`POST https://api.maple.dev/mcp` (`https://api.eu.maple.dev/mcp` for EU), Streamable HTTP,
`Authorization: Bearer maple_ak_…` — and its `run_sql` tool. Maple's transport is stateless, so one
POST is one call: no handshake to keep, nothing to resume. The route needs an `accept` offering both
`application/json` and `text/event-stream`, or it answers 406 before reading the body.

Hazel only ever calls `run_sql`, only with `SELECT`s over `product_events`, and every statement ANDs
in `$__orgFilter`, which Maple expands server-side to the key's own organization. A pull cannot read
another organization even in principle.

## What counts as activity

The query asks Maple for **identified rows only**: `GroupId != '' AND UserId != ''`. That one filter
does most of the work, because of how Maple's events are stamped:

| Rows                                                                 | Counted?                 | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$pageview` on the app host                                          | **yes**                  | About 95% carry a user and an organization, and app page views _are_ the usage: Maple deliberately emits no `*_viewed` events beside them                                                                                                                                                                                                                                                                                                                                                                          |
| `$pageview` and `page_scrolled` on `maple.dev`                       | no                       | Marketing traffic carries a `VisitorId` only — no user, no organization — so the identity filter drops it                                                                                                                                                                                                                                                                                                                                                                                                          |
| `dashboard_created`, `alert_rule_created`, `member_joined`, …        | **yes**                  | A person's deliberate action, with user and organization                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Server-side events with an organization but no user (`plan_started`) | not as activity          | Nobody's day. They still count for a **metric** (that query only needs `GroupId`)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| iOS events                                                           | no                       | The Swift SDK does not stamp identity on them yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mcp_tool_called`                                                    | **yes**, when identified | It is the person's agent acting as them, and an organization that uses Maple only through an agent is not idle. It is also the highest-volume event (~12k/day across all organizations), so it dominates `eventCount` where it lands. `eventCount` only decides the champion tiebreak — a day is "active" either way — but if the noise is unwanted, list the events that should count under **Activity events** and leave it out. In Maple's own data today it carries no identity, so nothing counts from it yet |

`eventCount` is the day's events and `sessionCount` its distinct non-empty `SessionId`s. A day with
either above zero makes its contact active, which is what `activeUsers30d`, the usage trend,
`lastActiveAt` and the champion are built from.

Preview deployments (`app-pr-1234.maple.dev`) are identified and therefore counted. For Maple's own
dogfood organization that is right — it is the team using the product.

## Mapping

| Maple                                                    | Hazel                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupId`                                                | `sameAs` the Clerk organization of the same id → that account. `onNoMatch: "unmatched"`, no name, no domain, no `matchByDomain`: Maple writes no account field and creates no account |
| `UserId`                                                 | the Clerk contact of the same id, named directly on the activity op                                                                                                                   |
| an unknown `GroupId`                                     | an unmatched record (provider `maple`, `account`) with the events seen, replayed when someone links it                                                                                |
| a `UserId` the account has no contact for                | an unmatched record (provider `clerk`, `contact`) with the account suggested                                                                                                          |
| events per (day, `GroupId`, `UserId`)                    | `customer_activity_daily.eventCount`                                                                                                                                                  |
| distinct `SessionId` per (day, `GroupId`, `UserId`)      | `customer_activity_daily.sessionCount`                                                                                                                                                |
| count of the events mapped to a key per (day, `GroupId`) | `customer_metric_daily.value` under `maple.<key>`                                                                                                                                     |
| several events mapped to one key                         | summed by the query (`transform(EventName, …)`), one row per key                                                                                                                      |
| every mapped key                                         | a `customer_metric_definitions` row, unit `events`, aggregation `sum`                                                                                                                 |

Metric keys are namespaced `maple.<key>` because ingest refuses a key another provider owns — a
Maple op naming `autumn.messages` is rejected and counted, not written.

**Maple emits no contact op.** `UpsertContact` has no `sameAs` and Maple knows no email address, so
a contact op would be matched by ref and then by email, find neither, and create a _second_ contact
beside the Clerk one it meant. Activity names the Clerk contact instead.

**Maple sweeps nothing.** It is authoritative for no record's existence: an account, contact or
subscription a pull did not see is not gone, so no page ever sets `PullPage.sweep`.

## Syncing

| Phase      | Query                           | Groups by                                         | Requests   |
| ---------- | ------------------------------- | ------------------------------------------------- | ---------- |
| `activity` | `run_sql` over `product_events` | day × `GroupId` × `UserId`                        | 1 per page |
| `metrics`  | `run_sql` over `product_events` | day × `GroupId` × metric key (mapped events only) | 1 per page |

Both phases are `GROUP BY` aggregates: **Maple counts, Hazel reads counts.** A pull never reads raw
events — `product_events` is the whole organization's, and the busiest event alone is thousands of
rows a day.

**The walk is one UTC day at a time**, activity before metrics, and the day advances only when both
are done. `run_sql` hands back at most **100 rows** of a result whatever the query matched (Maple's
own `MAX_RENDERED_ROWS`), with `truncated` set when it fetched more than it rendered. So each page is
`LIMIT 101 OFFSET <rows read>` over a total order (`account, contact` / `account, metric`), and the
walk stays on the day while `truncated` says more follows: a day with more than 100 active users
takes several pages rather than being cut, and a day of exactly 100 takes one. The cursor
(`{ day, phase, offset, until }`) is persisted on the run, so an evicted object resumes the same day.
A metric phase whose mappings were all removed mid-walk is skipped rather than sent an empty list.

The metric phase groups by **key**, not by event, because ingest _replaces_ a day's metric value:
grouped by event, two events mapped to one key could land on two pages, and the second page's part
would overwrite the first's.

**Window.** A backfill starts `lookbackDays` back; a scheduled pull starts at the day `since` falls
in, and core passes `lastSuccessAt` minus a 10-minute overlap — so an hourly pull re-reads today
and, around midnight, yesterday. The walk's last day is fixed when it starts, so one that runs past
midnight finishes where it began and the next pull picks up the new day.

**Re-reading is free.** Ingest keeps a day's _highest_ activity (`eventCount`, `sessionCount`) and
_replaces_ a day's metric value, so the same day read any number of times lands on the same numbers:
no day is ever counted twice, and a day read while it was still filling in is corrected by the next
pull. The one thing that does accumulate is an unmatched record's `eventCount30d`, which core
documents as an estimate rather than a ledger.

### Failures

- 401 / 403 → `auth`: the connection goes to `error` and pulls stop until the key changes. A key of
  the other region lands here, and the message says so.
- 429 → waited out in place while Maple's `Retry-After` is short (it asks for 10 s at 120 requests
  per 10 s), else handed to the alarm as `rate_limited`; core resumes the run at its cursor.
- 5xx, unreachable, or no answer within 30 s → `provider` / `network`, retried after core's backoff.
- Any other 4xx → `provider`, not retried.
- A tool failure (`result.isError`) or a JSON-RPC `error` → `provider`, **retried**: Maple reports
  its warehouse's failures inside a 200 this way (a ClickHouse or gateway error, a query over its
  120 s budget). The run resumes at its cursor, and core gives a run up after a few failed attempts
  at the same page, so one Maple will never answer cannot loop for good.
- A body Hazel cannot read, or a 200 with neither a result nor an error → `provider`, not retried:
  the run fails and the next scheduled pull starts over.
- None of these repeats Maple's own text in the message, because a run's message is synced to every
  member of the organization; the detail goes to a log line, and a decode failure is logged by path
  and issue kind only. A key of another organization than the configured one is refused without
  either id in the message (they go to the log).
- A row the mapping cannot use (another day than the page asked for, no group, no user, an
  unreadable count, a key nothing maps to) is skipped and counted on the run rather than failing
  the page.

## Known gaps

- **100 rows per request.** `run_sql` is capped, so a large organization's busy day takes several
  requests (a 1,000-active-user day is 10). A 90-day backfill of such an organization is a few
  hundred requests spread over the hourly schedule before it catches up; incremental pulls after
  that are one or two requests an hour. A public Maple endpoint for per-day aggregates (or a
  `limit` on `run_sql`'s rendered rows) would collapse this.
- **The key is broader than the data it reads.** Maple's MCP server requires read access across its
  whole toolset, so there is no key that reads _only_ product events. The MCP key (Settings → MCP)
  is the narrowest option and cannot touch the REST API.
- **No organization name.** Nothing on the MCP surface reports it, so the source is shown as
  "Maple (US)" / "Maple (EU)" rather than the Maple organization's name.
- **Offset paging on today.** Paging a day that is still receiving events can miss or repeat a row
  between pages. The next pull re-reads the day and fixes it; past days are immutable, so a backfill
  is exact.
- **Identity columns are fixed.** `GroupId` / `UserId` are the only columns Maple stamps identity
  on, so the account and user config fields accept nothing else (connecting says so). Reading an
  identity out of `Attributes` is the generalization this PR deliberately skips.
- **A key of another Maple organization keeps the old one's activity.** Core's account switch drops
  Maple's metrics and parked records and re-imports, but Maple's activity sits on Clerk's contacts,
  which the switch does not touch (it only clears activity on contacts the switched provider alone
  placed). Ingest keeps a day's highest count, so the old organization's days stay, merged with the
  new one's, until they age out of the windows that read them.
- **Config changes do not re-import history.** A pull reads from the last successful one onward, so
  narrowing the activity allowlist leaves the days already read at their higher counts (ingest
  keeps a day's highest), and a new metric mapping fills in from the next pull's window, not the
  lookback. Only a backfill (a new connection) reads the past again.
- **Parked records' `eventCount30d` is inflated.** An unmatched record adds the events of every op
  that lands on it, and the hourly pull re-reads today (and around midnight yesterday), so a parked
  group's count grows with each re-read: up to roughly 24× the day's real events. It is shown on,
  and orders, the unmatched list; no metric, score or signal reads it.
- **A region change needs a reconnect.** Changing the region in settings does not re-check the key
  (core only validates when a key is given), so the pull refuses until the key is re-entered.
- **`mcp_tool_called` is unidentified today**, so AI usage does not count yet even though the
  catalog says it carries user and organization. Nothing here changes when it starts to.
- **Clerk must be connected.** Without it there are no accounts or contacts for Maple's ids to land
  on, and every group and user parks as an unmatched record.
