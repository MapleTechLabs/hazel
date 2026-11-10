# Customers kit

Stateless Foldkit views for the Customers pages (Wonder "Maple Design System" › Foundations). Every
view is `(h, options) → Html`; selection, hover and open state live in the page's Model and come in
as options, Messages go out through `on*` callbacks. Try them all at `/lab/customers/kit/*`.

Colors are theme tokens (`src/core/styles/theme.css` › Customers): `chart-{new,expansion,contraction,
churn,neutral,series-1..3,grid,net}`, `health-{healthy,at-risk,critical,unknown}`,
`severity-{high,medium,low,off}` — use them as `bg-chart-new`, `stroke-chart-series-1`, …

## Formatting — `src/customers/format.ts`

| Export                                                                                                    | Example                                      |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `formatMoney(minor, currency?, { cents?, signed? })`                                                      | `$48,210`, `$1,240.00`, `+$9,400`, `−$1,000` |
| `formatMoneyCompact(minor, currency?, { signed? })`                                                       | `$48.2K`, `−$4K`                             |
| `formatCount(n)` / `formatCompact(n)`                                                                     | `1,611` / `461K`                             |
| `formatPct(pct)` / `formatDeltaPct(pct)` / `formatDeltaPoints(pts, unit?)` / `formatDeltaCount(n)`        | `61%` / `+6.2%` / `+0.9 pt` / `+12`          |
| `deltaTone(delta, goodWhen?)`                                                                             | `"positive" \| "negative" \| "neutral"`      |
| `formatRelative(at, now)` / `daysBetween(at, now)`                                                        | `18d ago`, `in 4d`                           |
| `formatDays(n)` / `formatDaysLeft(n)`                                                                     | `4 days` / `4 days left`                     |
| `formatDate(at, { now?, timeZone?, withYear? })` / `formatDateTime` / `formatWeekdayTime`                 | `Nov 9` / `Nov 9, 18:42` / `Wed, 9:00 AM`    |
| `formatDay(day)` / `formatDayLong` / `formatMonthShort` / `formatMonthLong` / `bucketLabels(bucket, day)` | UTC `Day` labels                             |

`Instant = Date | DateTime.Utc` (what `JsonDate` rows carry). Time-relative helpers take `now`.

## Badges — `ui/badges.ts`

- `healthBadge(h, { status, score? })` — pill; `score: null` shows `—`, omit to hide the number.
- `healthDot(h, { status, score })` — compact, for dense cells.
- `severityChip(h, severity)` / `severityGlyph(h, severity)` — bars; the glyph alone has a title.
- `kindChip(h, kind)` — `! Risk` / `↗ Opportunity`.
- `stageBadge(h, stage, { trialDaysLeft? })` — square, no dot.
- `signalCounts(h, { high, medium, low, opportunities })` — the list's open-signals cell.
- Labels/fills: `HEALTH_LABEL`, `HEALTH_FILL`, `SEVERITY_LABEL`, `KIND_LABEL`, `STAGE_LABEL`.

## Identity — `ui/identity.ts`

- `companyLogo(h, { name, logoUrl?, size?: "xs"|"sm"|"md"|"lg" })` — 20/28/40/48px, initials tint by name hash.
- `personAvatar(h, person | null, { size? })` — `null` = dashed "Unassigned"; `personLabel(h, person | null)`; `avatarStack(h, people, { max? })`.
- `sourceLogo(h, source)`, `sourceMark(h, source, { size? })` (tile), `sourceChip(h, source)`, `sourceLinkChip(h, { source, label, href })`.
- `SOURCE_LABEL`, `sourceLogoSrc(source)` (Brandfetch; Hazel uses `/icon.svg`), `initialsOf`, `tintIndex`.

## KPI and evidence — `ui/kpi-tile.ts`, `ui/evidence.ts`

- `kpiTile(h, { id, label, definition?, value?, detail?, delta?, comparison?, trend?, state?: "ready"|"loading"|"empty", emptyAction? })`
  — `delta = { value, text, goodWhen? }`; `trend` is usually `sparkline(h, { values, size: "md", area: true, ariaLabel })`.
- `deltaPill(h, delta)`, `definedLabel(h, { id, label, definition })` (hover/focus definition card, CSS only).
- `evidenceViz(h, evidence)` — the queue's mini-viz per `_tag` (amount, last_active, series, limit, delta, ratio).
- `evidenceDetail(h, evidence, { now })` — side panel: facts + chart (series → `evidenceBars`, limit → meter).
- `deltaSummary(deltaEvidence)` — `$1,240 → $0`, `62 → 48 pts`.

## Charts — `src/customers/charts/`

- `sparkline.ts`: `sparkline(h, { values, ariaLabel, tone?, size?: "sm"|"md", area?, endDot? })`, `barSparkline`, `meter(h, { value, limit, ariaLabel })`, `evidenceBars(h, { values, highlightFrom, baseline, ariaLabel, tone? })`, `trendTone(values)`.
- `line-chart.ts`: `lineChart(h, { ariaLabel, series, xLabels, headings, formatValue, formatAxis?, hoveredIndex, onHover, endLabels? })`;
  `activeUsersChart(h, { points, bucket, hoveredIndex, onHover })` over `OverviewResult.activeUsers`; `ACTIVE_USERS_LEGEND`.
- `stacked-bar-chart.ts`: `stackedBarChart(h, { ariaLabel, stacks, bars, netLabel?, formatValue, hoveredIndex, onHover })`;
  `mrrMovementChart(h, { buckets, bucket, currency, hoveredIndex, onHover })` over `OverviewResult.mrrMovements`; `mrrLegend(buckets)`.
- `distribution.ts`: `distributionBar(h, { segments, ariaLabel })`, `healthDistribution(h, { rows, bands, currency, metric, onMetric })` (the whole card).
- `frame.ts`: `chartCard(h, { title, description?, aside? }, children)`, `chartLegend(h, items)`, `chartTooltip`, `CHART_COLOR`.
- `scale.ts`: the math (`niceTicks`, `scaleLinear`, `linePath`, `stackSegments`, …).

Hover: the page keeps `hoveredIndex: number | null` per chart and passes `onHover: (index) => Message.HoveredChart({ chart: "mrr", index })`.
Charts fill their container's width (no measuring); set the height with `heightClass`.

## Tables and queue — `ui/data-table.ts`, `ui/queue-row.ts`

- `dataTable(h, { ariaLabel, id, columns, rows, rowKey, sort?, onSort?, selection?, onRowPress?, focusedKey?, rowActions?, loadingRows?, stickyHeader? })`
  — `Column = { key, label, align?, sortable?, widthClass?, hideClass?, cell, footer? }`; a footer row renders when any column has `footer`.
  `selection = { selected: ReadonlySet<string>, onToggle(key, isSelected), onToggleAll(isSelected) }`.
- `primaryCell(h, { leading?, title, subtitle?, href? })` — logo + name + domain.
- `queueRow(h, { id, rank, account, signal, evidence, age, assignee, health, isFocused?, isSelected?, onPress?, actions? })`,
  `queueList(h, { ariaLabel }, rows)`, `queueAction(h, { label, icon?, onPress?, iconOnly?, attributes?, overlay? })`, `planLine(account)`.
  Inline actions replace evidence…assignee on hover / focus. A press on an action also reaches the row's `onPress` (selects it).

## Controls — `ui/filter-bar.ts`, `ui/shortcuts.ts`

- `viewTabs(h, { ariaLabel, tabs: [{ key, label, count? }], selected, onSelect, trailing? })` — `Open 12 · Snoozed 4 · Done`, saved views.
- `segmented(h, { ariaLabel, segments, selected, onSelect })`, `rangePicker(h, { selected, onSelect, caption? })`, `RANGE_COMPARISON[range]`.
- `searchBox(h, { id, value, placeholder, onInput, onClear })` (app search field + `/` hint).
- `filterChip(h, { field, operator, value, onRemove, attributes?, overlay? })`, `addFilterButton(h, { attributes?, overlay?, onPress? })`, `sortTrigger(h, { label, attributes?, overlay? })`, `filterBar(h, { start, end? })`.
- `kbd(h, key)`, `shortcutBar(h, shortcuts)`, `QUEUE_SHORTCUTS`.

`attributes` / `overlay` are what `ui/menu-view` (or a popover) hands its `toTrigger`: spread them on the trigger, so the page's own Menu/Popover Submodel opens from these buttons.

## Menus — `ui/menus.ts` (for the app's `ui/menu` Submodel)

- Snooze: `snoozeMenuEntries`, `snoozeMenuContent(h, menuId, now)`, `snoozeUntil(key, now)`, `SNOOZE_KEYS`, `PICK_DATE_KEY`.
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
- `connectCard(h, { provider, now, status })` — `status._tag`: `NotConnected { onConnect }`, `Syncing { step, done, total, onCancel? }`, `Connected { syncedAt, summary, onSyncNow? }`, `Error { at, message, action }`. `PROVIDER_BLURB`.

## Lab

Fixtures: `src/lab/fixtures/customers.ts` (fixed `NOW`, 214 accounts, overview result, signals with every evidence viz, connections). See `src/lab/README.md` for adding page entries.
