# Customers domain views

Stateless Foldkit views for the Customers pages. Every view is `(h, options) → Html`; selection,
hover and open state live in the page's Model and come in as options, Messages go out through `on*`
callbacks. Try them all at `/lab/customers/kit/*`.

**Only domain views live here** (a lifecycle stage badge, a company logo, a severity chip, a queue
row, a KPI tile, a connect card…), and each is built from the app kit in `src/ui`. Generic
primitives are never redrawn here; take them from the kit (`DESIGN-RULES.md` › Patterns with one
owner):

| Need                                       | Kit piece (`src/ui/…`)                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| A page's title row, breadcrumb, freshness  | `pageHeader`, `breadcrumb`, `freshness`, `pageLayout` (page-header)         |
| A bordered box, a panel and its title row  | `card`, `panel`, `panelHeader`, `cardClassName` (card)                      |
| A table of records                         | `dataTable`, `primaryCell` (data-table)                                     |
| Joined toggle buttons (`7d 30d 90d`)       | `segmented` (segmented-control)                                             |
| A pill, tag or count                       | `badge`, `toggleChip` (badge, toggle-chip)                                  |
| A state dot, `● Synced 1h ago`             | `statusDot`, `statusLine` (status-dot)                                      |
| Nothing here / failed; a placeholder block | `emptyState` (empty-state), `skeleton` (skeleton), `loader`                 |
| Buttons, links, search, key caps, headings | `button`/`ariaButton`/`iconButton`, `link`, `searchField`, `kbd`, `heading` |
| An avatar                                  | `avatar` (avatar)                                                           |

If a domain view needs something the kit lacks, add it to the kit, not here.

Colors are theme tokens (`src/core/styles/theme.css` › Customers): `chart-{new,expansion,contraction,
churn,neutral,series-1..3,grid,net}`, `severity-{high,medium,low,off}` — use them as `bg-chart-new`,
`stroke-chart-series-1`, …

## Surface — `ui/surface.ts`

The little text grammar the kit has no component for. Headings are the kit's `heading`
(`display` for a page's title, `section` for a panel's, `subsection` for a group); `pageHeader` and
`panelHeader` render them for you.

- `titleClass` (an emphasised line, 14px semibold), `descriptionClass` (14px muted). Labels are
  sentence case; nothing is uppercase. A table head is `dataTable`'s.
- Links: `moreLink(h, href, "View queue")` (a panel's way out, with `›`, on the kit `link`);
  `linkClass` (the kit link's classes in primary, for an element `link` can't render).
  A link that leaves Hazel is a plain text link (`Open`, `View`) or a chip; never an external-link arrow.
- Text takes the `*-subtle-fg` semantic colors (`text-danger-subtle-fg`), not the raw `text-danger`.

## Formatting — `src/customers/format.ts`

| Export                                                                                                    | Example                                      |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `formatMoney(minor, currency?, { cents?, signed? })`                                                      | `$48,210`, `$1,240.00`, `+$9,400`, `−$1,000` |
| `formatMoneyCompact(minor, currency?, { signed? })`                                                       | `$48.2K`, `−$4K`                             |
| `formatCount(n)` / `formatCompact(n)`                                                                     | `1,611` / `461K`                             |
| `formatPct(pct)` / `formatDeltaPct(pct)` / `formatDeltaPoints(pts)` / `formatDeltaCount(n)`               | `61%` / `+6.2%` / `+0.9 pt` / `+12`          |
| `deltaTone(delta, goodWhen?)`                                                                             | `"positive" \| "negative" \| "neutral"`      |
| `formatRelative(at, now)` / `daysBetween(at, now)`                                                        | `18d ago`, `in 4d`                           |
| `formatDays(n)` / `formatDaysLeft(n)`                                                                     | `4 days` / `4 days left`                     |
| `formatDate(at, { now?, timeZone?, withYear? })` / `formatDateTime` / `formatWeekdayTime`                 | `Nov 9` / `Nov 9, 18:42` / `Wed, 9:00 AM`    |
| `formatDay(day)` / `formatDayLong` / `formatMonthShort` / `formatMonthLong` / `bucketLabels(bucket, day)` | UTC `Day` labels                             |

`Instant = Date | DateTime.Utc` (what `JsonDate` rows carry). Time-relative helpers take `now`.

## Badges — `ui/badges.ts`

- `severityChip(h, severity)` / `severityGlyph(h, severity)` — bars; the glyph alone has a title.
- `kindChip(h, kind)` — `! Risk` / `↗ Opportunity`.
- `stageBadge(h, stage, { trialDaysLeft? })` — square, no dot.
- `environmentBadge(h, environment)` — an account's environment (`EU`) beside its name; `environmentsHint(h, count)` — `+2 environments`, muted.
- `signalCounts(h, { high, medium, low, opportunities })` — the list's open-signals cell.
- Labels: `SEVERITY_LABEL`, `KIND_LABEL`, `STAGE_LABEL`.

## Identity — `ui/identity.ts`

- `companyLogo(h, { name, logoUrl?, size?: "2xs"|"xs"|"sm"|"md"|"lg" })` — 16/20/28/40/48px, initials tint by name hash (the theme's `*-subtle` pairs).
- `personAvatar(h, person | null, { size? })` (on the kit `avatar`) — `null` = dashed "Unassigned"; `personLabel(h, person | null)`; `avatarStack(h, people, { max? })`.
- `sourceLogo(h, source)`, `sourceMark(h, source, { size? })` (tile), `sourceChip(h, source)`, `sourceLinkChip(h, { source, label, href })`
  (the chip itself is the link out; no arrow glyph, the accessible name and title say where it goes).
- `sourceLabel(source)` (`../providers`), `sourceLogoSrc(source)` (Brandfetch; Hazel uses `/icon.svg`), `initialsOf`, `tintIndex`.

## KPI and evidence — `ui/kpi-tile.ts`, `ui/evidence.ts`

- `kpiTile(h, { id, label, definition?, value?, detail?, delta?, comparison?, trend?, state?: "ready"|"loading"|"empty", emptyAction? })`
  — `delta = { value, text, goodWhen? }`; `trend` is usually `sparkline(h, { values, size: "md", area: true, ariaLabel })`.
- `deltaPill(h, delta)`, `definedLabel(h, { id, label, definition })` (hover/focus definition card, CSS only).
- `evidenceViz(h, evidence)` — the queue's mini-viz per `_tag` (amount, last_active, series, limit, delta, ratio).
- `evidenceDetail(h, evidence, { now })` — side panel: facts + chart (series → `evidenceBars`, limit → meter).
- `deltaSummary(deltaEvidence)` — `$1,240 → $0`, `8 → 20 users`.

## Charts — `src/customers/charts/`

- `sparkline.ts`: `sparkline(h, { values, ariaLabel, tone?, size?: "sm"|"md", area?, endDot? })`, `barSparkline`, `meter(h, { value, limit, ariaLabel })`, `evidenceBars(h, { values, highlightFrom, baseline, ariaLabel, tone? })`, `trendTone(values)`.
- `line-chart.ts`: `lineChart(h, { ariaLabel, series, xLabels, headings, formatValue, formatAxis?, hoveredIndex, onHover, endLabels? })`;
  `activeUsersChart(h, { points, bucket, hoveredIndex, onHover })` over `OverviewResult.activeUsers`; `ACTIVE_USERS_LEGEND`.
- `stacked-bar-chart.ts`: `stackedBarChart(h, { ariaLabel, stacks, bars, netLabel?, formatValue, hoveredIndex, onHover })`;
  `mrrMovementChart(h, { buckets, bucket, currency, hoveredIndex, onHover })` over `OverviewResult.mrrMovements`; `mrrLegend(buckets)`.
- `distribution.ts`: `distributionBar(h, { segments, ariaLabel })`.
- `frame.ts`: `chartCard(h, { title, description?, aside? }, children)`, `chartLegend(h, items)`, `chartTooltip`, `CHART_COLOR`.
- `scale.ts`: the math (`niceTicks`, `scaleLinear`, `linePath`, `stackSegments`, …).

Hover: the page keeps `hoveredIndex: number | null` per chart and passes `onHover: (index) => Message.HoveredChart({ chart: "mrr", index })`.
Charts fill their container's width (no measuring); set the height with `heightClass`.

## Queue — `ui/queue-row.ts`

Tables are the kit's `dataTable` and `primaryCell` (`src/ui/data-table.ts`).

- `queueRow(h, { id, rank, account, signal, evidence, age, assignee, isFocused?, isSelected?, run?, onPress?, actions? })`,
  `queueList(h, { ariaLabel }, rows)`, `queueAction(h, { label, icon?, onPress?, iconOnly?, shortcut?, attributes?, overlay? })`, `planLine(account)`,
  `accountMark(h, account, run?)` (the logo, joined by a line to the same account's rows).
  Inline actions replace evidence…assignee on hover / focus. A press on an action also reaches the row's `onPress` (selects it).

## Controls — `ui/filter-bar.ts`, `ui/shortcuts.ts`

- `viewTabs(h, { ariaLabel, tabs: [{ key, label, count? }], selected, onSelect, trailing? })` — `Open 12 · Snoozed 4 · Done`, saved views.
- `rangePicker(h, { selected, onSelect, caption? })` (on the kit `segmented`).
- `searchBox(h, { id, value, placeholder, onInput, onClear })` (app search field + `/` hint).
- `filterChip(h, { field, operator, value, onRemove, attributes?, overlay? })`, `addFilterButton(h, { attributes?, overlay?, onPress? })`, `sortTrigger(h, { label, attributes?, overlay? })`, `filterBar(h, { start, end? })`.
- `kbd(h, key)`, `shortcutBar(h, shortcuts)`, `QUEUE_SHORTCUTS`.

`attributes` / `overlay` are what `ui/menu-view` (or a popover) hands its `toTrigger`: spread them on the trigger, so the page's own Menu/Popover Submodel opens from these buttons.

## Menus — `ui/menus.ts` (for the app's `ui/menu` Submodel)

- Snooze: `snoozeMenuEntries`, `snoozeMenuContent(h, menuId, now)`, `snoozeUntil(key, now)`, `SNOOZE_KEYS`, `PICK_DATE_KEY`.
- Mute (a customer out of Needs attention): `muteLeaves` (a submenu), `MUTE_LABEL`, `isMuteKey`, `muteUntil(key, now)`.
- Row actions: `rowActionsEntries({ championEmail })`, `rowActionsContent(h, menuId, now)` (Snooze is a submenu: leaf keys `snooze:<key>`),
  `snoozeKeyOfLeaf(key)`, `snoozeInstantOf(key, now)`.

```ts
h.submodel({
	slotId: model.snoozeMenu.id,
	model: model.snoozeMenu,
	view: MenuView.view,
	viewInputs: {
		entries: snoozeMenuEntries,
		content: snoozeMenuContent(h, model.snoozeMenu.id, now),
		toTrigger: (attributes, overlay) =>
			queueAction(h, { label: "Snooze", icon: IconClock(h), attributes, overlay }),
	},
	toParentMessage: (message) => Message.GotSnoozeMenuMessage({ message }),
})
```

## Empty states and sources — `ui/empty-states.ts`, `ui/connect-card.ts`

- `allClearState(h, { snoozedCount, onViewSnoozed? })`, `noSourcesState(h, { onConnect? | action? })`, `noResultsState(h, { onClear?, title?, description? })` — `framed: false` drops the border.
- `connectCard(h, { provider, now, status })` — `status._tag`: `NotConnected { onConnect }`, `Syncing { step, done, total, onCancel? }`, `Connected { syncedAt, summary, onSyncNow? }`, `Error { at, message, action }`. The line under the name is `providerOf(provider).blurb` unless `description` is given.

## Lab

Fixtures: `src/lab/fixtures/customers.ts` (fixed `NOW`, 214 accounts, overview result, signals with every evidence viz, connections). See `src/lab/README.md` for adding page entries.
