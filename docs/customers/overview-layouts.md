# Customer Overview: metrics and layouts

The customer page's Overview tab used to be fixed: active users, usage trend, MRR, seats, last
active, a usage chart and the built-in sections. Teams whose customers are healthy without ever
logging in (an observability product: what matters is the data they send and the features they
use) need a different page. Now the Overview is data, edited in settings without code changes.

Contracts: `packages/domain/src/customers/overview.ts` (sources, formulas, widgets, rules, results),
`packages/domain/src/rpc/customers.ts` (`customers.metric.*`, `customers.layout.*`,
`customers.account.metricWindows`, `customers.account.setLayout`), tables in
`packages/db/src/tables/customers.ts` (`customer_metric_definitions` new columns,
`customer_overview_layouts`, `customer_accounts.pinnedLayoutId`/`layoutId`). Designs: Wonder file
"Maple Design System", pages "Hazel Customers · Customer Page" and "… · Signals & Health Settings".

## Metrics

A metric is a daily value per account in `customer_metric_daily`, with a definition in
`customer_metric_definitions` (synced). Over a window its days combine by `aggregation`: `sum`,
`max`, or `last`.

| Kind | `source` | `provider` | Written by |
|---|---|---|---|
| Built-in (`active_users`, `active_users_30d`, `mrr`, `health_score`) | null | null | derived at read time (`facts.ts`) |
| A source's own (Autumn features, Maple event mappings in the connection config) | null | the provider | that provider's pull |
| **Maple query** | `maple_query` | `maple` | the Maple pull's `queries` phase |
| **Product event** | `product_event` | `maple` | the Maple pull's `metrics` phase (joined to the config's mappings) |
| **Formula** | `formula` | null | nothing: evaluated at read time over its operands |

- User-defined keys are created with the metric (`UserMetricKey`), never change, and are written
  to `customer_metric_daily` under that key. Maple-sourced user keys need no `maple.` prefix of
  their own: ingest's per-provider key ownership treats a definition with `provider = maple` as
  Maple's.
- `group` sections the catalog and feeds metric tables (`MetricTableRows` `group`). `format`
  (`number | bytes | percent | money | duration_ms`) and `unit` decide how a value reads
  (web: `formatMetric` in `src/customers/format.ts`).
- **Maple query.** One SQL statement over Maple's warehouse, run through the Maple connection's key
  (`run_sql`), once per UTC day of the window. Contract (`checkMapleSql`): AND in `$__orgFilter` and
  `$__timeFilter(<time column>)`, select `account` (the customer's Clerk organization id, the same id
  Maple product events carry as `GroupId`) and `value`, group by account, no `ORDER BY`/`LIMIT`/
  `SETTINGS`. The pull appends `ORDER BY account LIMIT <cap+1> OFFSET <n>` and pages like the other
  phases. Each row becomes a `RecordMetric` for the account whose Maple/Clerk ref is `account`
  (unknown ids are counted, not held as unmatched records). The query builder
  (`MapleQueryBuilder` → `mapleBuilderSql`) writes the same SQL; the builder is kept so the editor
  reopens it. Example, logs ingested per customer:

  ```sql
  SELECT Attributes['org_id'] AS account, sum(Value) AS value
  FROM metrics_sum
  WHERE $__orgFilter
    AND $__timeFilter(TimeUnix)
    AND Attributes['org_id'] != ''
    AND MetricName = 'maple_ingest_org_bytes_total'
    AND Attributes['signal'] = 'logs'
  GROUP BY account
  ```

  `lastRunAt`/`lastError` on the definition record the last page run for it (error text is Hazel's
  own, never Maple's internals). A created or changed query is backfilled over the connection's
  `lookbackDays` by a Maple sync run started on save.
- **Product event.** Counts of the listed Maple product events per account and day. The Maple pull's
  metric map is the connection config's `metricMappings` plus every `product_event` definition.
- **Formula.** `{key}` operands, numbers, `+ - * /`, parentheses (`parseFormula`). Over a window
  each operand is aggregated by its own aggregation first, then the formula is applied
  (`{bytes} / {spans}` over 30 days is a ratio of sums, not a sum of ratios). A daily series applies
  it per day. Division by zero or a missing operand is null. Formulas may not reference formulas
  (one level; refused on save).

## Widgets

`OverviewWidget` (4-column grid, `span` 1–4):

- **Stat**: one metric over `windowDays`, optional comparison with the window before, which way is
  good, a label template (`{window}`, `{metric}`), hidden when the customer has no value.
- **Chart**: up to 6 metrics, bars / stacked bars / line, opening range 7d/30d/90d (the viewer can
  change it). Reads `customers.account.series`.
- **Metric table**: rows from a metric group (new metrics in the group appear automatically) or a
  hand-picked list; value over the window, optional trend and last used; a metric counts as used at
  `usedAtLeast`; unused rows shown dimmed last, or hidden; order by value, name or last used;
  `exclude` drops some of a group. Reads `customers.account.metricWindows`.
- **Built-in**: the page's own sections: `health` (score and breakdown), `signals` (open signals),
  `subscription`, `notes` (pinned notes), `activity` (recent events), `last_active`.

A widget naming a metric the org does not have renders a "Metric not set up" state with a link to
create it (`/settings/metrics/new?key=<key>`).

## Layouts

`customer_overview_layouts` (synced): name, `position`, `isDefault`, `rule`, `widgets`,
`accountCount`. Exactly one live default, seeded with `DEFAULT_LAYOUT_WIDGETS` (what the Overview
showed before) on install and, for existing orgs, on the first activation after this change.

- **Rule** (`LayoutRule`): `all` or `any` of conditions on stage, plan, tags, health, MRR, an
  attribute, or a metric over a window (`metric > X over N days`). No conditions: everyone.
- **Resolution** (`resolveLayout`): the pinned layout, else the first non-default layout by
  `position` whose rule matches, else the default.
- **Assignment** is server-side, because metric conditions need stored values: the object computes
  every account's `layoutId` (and each layout's `accountCount`) after a layout is created, updated,
  deleted or reordered, after a pin, and at the end of each compute pass (metric values move). Only
  changed rows are written. The client reads `account.layoutId` and the synced layout.
- **Dry run** (`customers.layout.dryRun`): who a draft rule matches at its place in the order, who
  of them an earlier layout or a pin already takes (the editor's overlap warning, "Move above …"),
  and how many it would really get.

## UI

- Settings sidebar: **Metrics** (`/settings/metrics`) and **Overview layouts** (`/settings/layouts`).
- Metrics catalog grouped by `group`; columns source, unit/format, customers with data, used in
  (layouts naming it), last run. Metric editor (`/settings/metrics/new`, `/settings/metrics/$key`):
  basics, source tabs (Maple query with builder and SQL, Product event, Formula), "over a window",
  preview (`customers.metric.preview`: customers with data, a sample customer's chart, top
  customers), "used by".
- Layouts list: ordered, rule chips, customer counts, reorder, default last. "New layout" dialog:
  name and a starting point (blank, a copy of a layout, starters: Observability, Trial onboarding,
  Feature adoption, Seats and revenue). Full-page editor (`/settings/layouts/new`,
  `/settings/layouts/$id`, `?preview=<accountId>`): canvas drawing the widgets with a previewed
  customer's real data, widget library, settings panel per widget type, metric picker, "Who gets
  this layout" rule popover with match count and overlap warning, Save/Discard.
- Overview tab: draws the account's layout. Header: the layout's name with a menu to pin the customer
  to another layout (or back to automatic), and "Customize" (admins) opening the editor previewing
  this customer.
