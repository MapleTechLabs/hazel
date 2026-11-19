import * as Customers from "@hazel/domain/customers"
import { Match, Option } from "effect"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconArrowPath, IconEyeSlash, IconWarning } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { button } from "../../ui/button"
import { type ChartColor, chartCard, chartLegend } from "../charts/frame"
import { lineChart } from "../charts/line-chart"
import { stackedBarChart } from "../charts/stacked-bar-chart"
import {
	dayToMs,
	deltaTone,
	formatCompact,
	formatDay,
	formatDayLong,
	formatDeltaPct,
	formatMetric,
} from "../format"
import { segmented } from "../ui/filter-bar"
import { type BuiltInContext, builtInView, statTile } from "./built-ins"
import * as OverviewData from "./data"
import { groupKeysOf, type MetricDef } from "./rows"

/**
 * Draws a layout's widgets for one customer (`docs/customers/overview-layouts.md` › Widgets): stats,
 * charts, metric tables and the built-in sections, on a 4-column grid each widget spans part of. The
 * Overview tab and the layout editor's canvas share it; the data comes from `OverviewData`.
 */

const DAY_MS = 86_400_000

export interface WidgetContext<M> {
	readonly data: OverviewData.Model
	/** Null until the definitions synced: no metric reads as missing before then. */
	readonly metrics: ReadonlyArray<MetricDef> | null
	readonly currency: string
	readonly toMessage: (message: OverviewData.Message) => M
	readonly builtIn: BuiltInContext
	/** The editor: a stat hidden for this customer says so instead of leaving a gap. */
	readonly showHidden?: boolean
}

const metricOf = <M>(context: WidgetContext<M>, key: string): MetricDef | undefined =>
	context.metrics?.find((metric) => metric.key === key)

/** Defined metrics only; null while the definitions load. */
const isMissing = <M>(context: WidgetContext<M>, key: string): boolean =>
	context.metrics !== null && metricOf(context, key) === undefined

const PLAIN: Pick<MetricDef, "format" | "unit"> = { format: "number", unit: null }

const valueText = <M>(context: WidgetContext<M>, key: string, value: number): string =>
	formatMetric(value, metricOf(context, key) ?? PLAIN, context.currency)

export const createMetricHref = (orgSlug: string, key: string): string =>
	hrefOf(AppRoute.CustomersSettingsMetricNew({ orgSlug, key: Option.some(key), source: Option.none() }))

const createLink = <M>(h: HtmlBuilder<M>, context: WidgetContext<M>, key: string): Html =>
	h.a(
		[
			h.Href(createMetricHref(context.builtIn.orgSlug, key)),
			h.Class("whitespace-nowrap font-medium text-primary text-sm hover:underline"),
		],
		["Create metric"],
	)

const retryButton = <M>(h: HtmlBuilder<M>, context: WidgetContext<M>): Html =>
	button(
		h,
		{ intent: "plain", size: "xs", onPress: context.toMessage(OverviewData.Message.PressedRetry()) },
		[IconArrowPath(h, { attributes: { "data-slot": "icon" } }), "Try again"],
	)

const skeleton = <M>(h: HtmlBuilder<M>, className: string): Html =>
	h.span([h.AriaHidden(true), h.Class(twMerge("block animate-pulse rounded bg-secondary", className))])

/** `+12% vs prior 30d`, green or red by which way is good. */
const deltaLine = <M>(
	h: HtmlBuilder<M>,
	change: number | null,
	goodDirection: Customers.StatWidget["goodDirection"],
	versus: string,
): Html | undefined => {
	if (change === null) return undefined
	const tone = goodDirection === "neutral" ? "neutral" : deltaTone(Math.round(change), goodDirection)
	return h.span(
		[h.Class("inline-flex items-baseline gap-1")],
		[
			h.span(
				[
					h.Class(
						twMerge(
							"font-medium tabular-nums",
							tone === "positive"
								? "text-success-subtle-fg"
								: tone === "negative"
									? "text-danger-subtle-fg"
									: "text-fg-2",
						),
					),
				],
				[formatDeltaPct(Math.round(change))],
			),
			versus,
		],
	)
}

/** The change from the window before, in percent; null without both values. */
const changeOf = (window: Customers.MetricWindow | undefined): number | null =>
	window === undefined || window.value === null || window.previous === null || window.previous === 0
		? null
		: ((window.value - window.previous) / Math.abs(window.previous)) * 100

// STAT

const notSetUpNote = <M>(h: HtmlBuilder<M>, context: WidgetContext<M>, key: string): ReadonlyArray<Html> => [
	h.span(
		[h.Class("inline-flex items-center gap-1.5 font-medium text-sm text-warning-subtle-fg")],
		[IconWarning(h, { className: "size-4 shrink-0" }), "Metric not set up"],
	),
	h.span(
		[h.Class("flex items-center gap-2 text-muted-fg text-xs")],
		[h.code([], [key]), createLink(h, context, key)],
	),
]

const statView = <M>(
	h: HtmlBuilder<M>,
	widget: Customers.StatWidget,
	context: WidgetContext<M>,
): Html | null => {
	const metric = metricOf(context, widget.metricKey)
	const label = Customers.statLabel(widget, metric?.name ?? widget.metricKey)
	const frame = (children: ReadonlyArray<Html>) =>
		h.div(
			[
				h.Id(`customer-kpi-${widget.id}`),
				h.Class(
					"flex h-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-bg p-4 max-md:p-3",
				),
			],
			[h.span([h.Class("truncate font-medium text-muted-fg text-xs/5")], [label]), ...children],
		)
	if (isMissing(context, widget.metricKey)) return frame(notSetUpNote(h, context, widget.metricKey))
	const { windows } = context.data
	const window = OverviewData.windowOf(context.data, widget.metricKey, widget.windowDays)
	if (!AsyncData.hasData(windows))
		return AsyncData.isFailure(windows)
			? frame([h.span([h.Class("text-muted-fg text-sm")], ["Couldn't load."]), retryButton(h, context)])
			: frame([skeleton(h, "mt-1 h-7 w-24"), skeleton(h, "h-3 w-20")])
	const value = window?.value ?? null
	if (value === null && widget.hideWhenEmpty)
		return context.showHidden === true
			? frame([
					h.span(
						[h.Class("flex items-start gap-1.5 text-muted-fg text-xs")],
						[
							IconEyeSlash(h, { className: "mt-0.5 size-3.5 shrink-0" }),
							`Hidden for ${context.builtIn.account.name}: no data in ${widget.windowDays} days`,
						],
					),
				])
			: null
	return statTile(h, {
		id: widget.id,
		label,
		value: value === null ? "—" : valueText(context, widget.metricKey, value),
		detail:
			widget.compare === "previous"
				? deltaLine(h, changeOf(window), widget.goodDirection, `vs prior ${widget.windowDays}d`)
				: undefined,
	})
}

// CHART

const CHART_COLORS: ReadonlyArray<ChartColor> = [
	"series-1",
	"series-2",
	"series-3",
	"new",
	"expansion",
	"neutral",
]

export const STYLE_LABEL = { bars: "Bars", stacked: "Stacked", line: "Line" } as const

const RANGE_SEGMENTS = OverviewData.ChartRange.literals.map((range) => ({ key: range, label: range }))

const chartBody = <M>(
	h: HtmlBuilder<M>,
	widget: Customers.ChartWidget,
	context: WidgetContext<M>,
	chart: OverviewData.Chart,
): Html => {
	const keys = widget.metricKeys.filter((key) => !isMissing(context, key))
	if (keys.length === 0)
		return h.div(
			[h.Class("flex flex-col items-center gap-2 py-10 text-center")],
			notSetUpNote(h, context, widget.metricKeys[0] ?? ""),
		)
	const series = Option.getOrUndefined(AsyncData.getData(chart.series))
	if (series === undefined)
		return AsyncData.isFailure(chart.series)
			? h.div(
					[h.Class("flex flex-col items-center gap-2 py-12 text-center text-muted-fg text-sm")],
					["Couldn't load this chart.", retryButton(h, context)],
				)
			: h.div([h.AriaHidden(true), h.Class("h-48 animate-pulse rounded-lg bg-secondary/40")])
	const shown = keys.flatMap((key) => {
		const found = series.find((entry) => entry.metricKey === key)
		return found === undefined ? [] : [found]
	})
	const days = shown[0]?.points.map((point) => point.day) ?? []
	const valuesOf = (entry: Customers.MetricSeries) => {
		const byDay = new Map(entry.points.map((point) => [point.day, point.value]))
		return days.map((day) => byDay.get(day) ?? 0)
	}
	const all = shown.flatMap(valuesOf)
	if (all.every((value) => value === 0))
		return h.p([h.Class("py-12 text-center text-muted-fg text-sm")], ["No data in this range."])
	const first = metricOf(context, shown[0]?.metricKey ?? "") ?? PLAIN
	const formatValue = (value: number) => formatMetric(value, first, context.currency)
	const formatAxis = (value: number) =>
		first.format === "number"
			? Math.abs(value) < 1
				? formatValue(value)
				: formatCompact(value)
			: formatValue(value)
	const label = (entry: Customers.MetricSeries) => metricOf(context, entry.metricKey)?.name ?? entry.name
	const colorOf = (index: number): ChartColor => CHART_COLORS[index % CHART_COLORS.length] ?? "series-1"
	const hovered = context.data.hovered?.widgetId === widget.id ? context.data.hovered.index : null
	const onHover = (index: number | null) =>
		context.toMessage(OverviewData.Message.HoveredChart({ widgetId: widget.id, index }))
	const ariaLabel = `${widget.title}: ${shown.map(label).join(", ")}, daily`
	const plot =
		widget.style === "line"
			? lineChart(h, {
					ariaLabel,
					series: shown.map((entry, index) => ({
						key: entry.metricKey,
						label: label(entry),
						color: colorOf(index),
						values: valuesOf(entry),
					})),
					xLabels: days.map(formatDay),
					headings: days.map(formatDayLong),
					formatValue,
					formatAxis,
					integerTicks: all.every(Number.isInteger),
					hoveredIndex: hovered,
					onHover,
					maxXTicks: 6,
					heightClass: "h-48",
				})
			: stackedBarChart(h, {
					ariaLabel,
					stacks: shown.map((entry, index) => ({
						key: entry.metricKey,
						label: label(entry),
						color: colorOf(index),
					})),
					bars: days.map((day, index) => {
						const values = Object.fromEntries(
							shown.map((entry) => [entry.metricKey, valuesOf(entry)[index] ?? 0]),
						)
						return {
							tick: formatDay(day),
							heading: formatDayLong(day),
							values,
							net: Object.values(values).reduce((sum, value) => sum + value, 0),
						}
					}),
					formatValue,
					formatAxis,
					integerTicks: all.every(Number.isInteger),
					hoveredIndex: hovered,
					onHover,
					maxXTicks: 6,
					heightClass: "h-48",
				})
	const missing = widget.metricKeys.filter((key) => isMissing(context, key))
	return h.div(
		[h.Class("flex flex-col gap-3")],
		[
			plot,
			...(shown.length > 1
				? [
						chartLegend(
							h,
							shown.map((entry, index) => ({ label: label(entry), color: colorOf(index) })),
						),
					]
				: []),
			...missing.map((key) =>
				h.p(
					[h.Key(key), h.Class("flex items-center gap-2 text-muted-fg text-xs")],
					[
						IconWarning(h, { className: "size-3.5 shrink-0 text-warning-subtle-fg" }),
						h.code([], [key]),
						"is not set up",
						createLink(h, context, key),
					],
				),
			),
		],
	)
}

const chartView = <M>(h: HtmlBuilder<M>, widget: Customers.ChartWidget, context: WidgetContext<M>): Html => {
	const chart = OverviewData.chartOf(context.data, widget)
	const names = widget.metricKeys.map((key) => metricOf(context, key)?.name ?? key)
	return chartCard(
		h,
		{
			title: widget.title === "" ? names.join(", ") : widget.title,
			description: `Daily${widget.style === "stacked" ? ", stacked" : ""}. ${names.join(", ")}, last ${chart.range.replace("d", " days")}.`,
			aside: segmented(h, {
				ariaLabel: "Date range",
				segments: RANGE_SEGMENTS,
				selected: chart.range,
				onSelect: (range) =>
					context.toMessage(OverviewData.Message.ClickedChartRange({ widgetId: widget.id, range })),
			}),
			className: "h-full",
		},
		[chartBody(h, widget, context, chart)],
	)
}

// METRIC TABLE

type TableRow = Readonly<{
	key: string
	metric: MetricDef | undefined
	window: Customers.MetricWindow | undefined
	isUsed: boolean
}>

/** Used rows in the table's order, then the unused (unless hidden), then those not set up. */
export const tableRows = <M>(
	widget: Customers.MetricTableWidget,
	context: WidgetContext<M>,
): Readonly<{ rows: ReadonlyArray<TableRow>; used: number; defined: number }> => {
	const keys = Customers.widgetMetricKeys(widget, groupKeysOf(context.metrics))
	const rows = keys.map((key): TableRow => {
		const window = OverviewData.windowOf(context.data, key, widget.windowDays)
		const value = window?.value ?? null
		return {
			key,
			metric: metricOf(context, key),
			window,
			isUsed: value !== null && value >= widget.usedAtLeast,
		}
	})
	const nameOf = (row: TableRow) => row.metric?.name ?? row.key
	const compare = (left: TableRow, right: TableRow) =>
		widget.order === "name"
			? nameOf(left).localeCompare(nameOf(right))
			: widget.order === "last_used"
				? (right.window?.lastSeenDay ?? "").localeCompare(left.window?.lastSeenDay ?? "")
				: (right.window?.value ?? 0) - (left.window?.value ?? 0)
	const defined = rows.filter((row) => !isMissing(context, row.key))
	const used = defined.filter((row) => row.isUsed)
	return {
		rows: [
			...used.sort(compare),
			...(widget.unused === "show" ? defined.filter((row) => !row.isUsed).sort(compare) : []),
			...rows.filter((row) => isMissing(context, row.key)),
		],
		// Counted before unused rows are left out: "4 of 7 used" whatever the table shows.
		used: used.length,
		defined: defined.length,
	}
}

const lastUsedText = (day: string | null, nowMs: number): string => {
	if (day === null) return "Never"
	const days = Math.floor((nowMs - dayToMs(day)) / DAY_MS)
	return days <= 0 ? "Today" : days === 1 ? "Yesterday" : formatDay(day)
}

const TABLE_COLUMNS = "grid items-center gap-x-4 px-4 sm:px-5"

const tableView = <M>(
	h: HtmlBuilder<M>,
	widget: Customers.MetricTableWidget,
	context: WidgetContext<M>,
): Html => {
	const { columns } = widget
	const template = twMerge(
		TABLE_COLUMNS,
		columns.trend && columns.lastUsed
			? "grid-cols-[minmax(0,1fr)_8rem_4.5rem_5.5rem]"
			: columns.trend || columns.lastUsed
				? "grid-cols-[minmax(0,1fr)_8rem_5.5rem]"
				: "grid-cols-[minmax(0,1fr)_8rem]",
	)
	const { windows } = context.data
	const { rows, used: usedCount, defined: definedCount } = tableRows(widget, context)
	// A group's rows are unknown until the definitions sync.
	const isLoading = !AsyncData.hasData(windows) || context.metrics === null
	const description = isLoading
		? undefined
		: `${usedCount} of ${definedCount} used in the last ${widget.windowDays} days.`
	const cell = (className: string, children: ReadonlyArray<Html | string>) =>
		h.span([h.Class(twMerge("text-sm tabular-nums", className))], [...children])
	const row = (entry: TableRow): Html => {
		const isMissingRow = entry.metric === undefined && context.metrics !== null
		const value = entry.window?.value ?? null
		const change = changeOf(entry.window)
		// A number's unit reads quieter beside it: `12,408 sessions`.
		const unit =
			entry.metric?.format === "number" && entry.metric.unit !== "minor" ? entry.metric.unit : null
		return h.div(
			[
				h.Key(entry.key),
				h.Class(
					twMerge(
						template,
						"min-h-12 border-border border-t py-2",
						!entry.isUsed && !isMissingRow && "text-muted-fg",
					),
				),
			],
			[
				h.span(
					[h.Class("flex min-w-0 items-center gap-2.5")],
					[
						isMissingRow
							? IconWarning(h, { className: "size-3.5 shrink-0 text-warning-subtle-fg" })
							: h.span([
									h.AriaHidden(true),
									h.Class(
										twMerge(
											"size-2 shrink-0 rounded-full",
											entry.isUsed ? "bg-success" : "border border-muted-fg",
										),
									),
								]),
						h.span(
							[h.Class("flex min-w-0 flex-col")],
							[
								h.span(
									[
										h.Class(
											twMerge(
												"truncate font-medium text-sm",
												entry.isUsed || isMissingRow ? "text-fg" : "text-muted-fg",
											),
										),
									],
									[entry.metric?.name ?? entry.key],
								),
								...(entry.metric === undefined
									? []
									: [h.code([h.Class("truncate text-muted-fg text-xs")], [entry.key])]),
							],
						),
					],
				),
				...(isMissingRow
					? [
							cell("font-medium text-warning-subtle-fg", ["Metric not set up"]),
							...(columns.trend || columns.lastUsed
								? [h.span([h.Class("flex justify-end")], [createLink(h, context, entry.key)])]
								: []),
							...(columns.trend && columns.lastUsed ? [h.span([])] : []),
						]
					: [
							cell(
								"",
								!AsyncData.hasData(windows)
									? [skeleton(h, "h-3 w-16")]
									: value === null || !entry.isUsed
										? ["Not used"]
										: [
												h.span(
													[h.Class("font-medium text-fg")],
													[
														formatMetric(
															value,
															entry.metric === undefined
																? PLAIN
																: { ...entry.metric, unit: null },
															context.currency,
														),
													],
												),
												...(unit === null
													? []
													: [
															h.span(
																[h.Class("ml-1 text-muted-fg text-xs")],
																[unit],
															),
														]),
											],
							),
							...(columns.trend
								? [
										cell("text-right", [
											change === null || !entry.isUsed
												? "—"
												: (deltaLine(h, change, "up", "") ?? "—"),
										]),
									]
								: []),
							...(columns.lastUsed
								? [
										cell("text-right", [
											lastUsedText(
												entry.window?.lastSeenDay ?? null,
												context.builtIn.nowMs,
											),
										]),
									]
								: []),
						]),
			],
		)
	}
	return h.section(
		[h.Class("flex h-full min-w-0 flex-col rounded-xl border border-border bg-bg")],
		[
			h.header(
				[h.Class("flex flex-col gap-0.5 px-4 pt-4 pb-3 sm:px-5")],
				[
					h.span(
						[h.Class("font-semibold text-base text-fg")],
						[widget.title === "" ? "Metrics" : widget.title],
					),
					...(description === undefined
						? []
						: [h.p([h.Class("text-muted-fg text-sm")], [description])]),
				],
			),
			h.div(
				[
					h.AriaHidden(true),
					h.Class(
						twMerge(template, "h-9 border-border border-t font-medium text-muted-fg text-xs"),
					),
				],
				[
					h.span([], [widget.rows._tag === "group" ? widget.rows.group : "Metric"]),
					h.span([], [`Last ${widget.windowDays} days`]),
					...(columns.trend ? [h.span([h.Class("text-right")], ["Change"])] : []),
					...(columns.lastUsed ? [h.span([h.Class("text-right")], ["Last used"])] : []),
				],
			),
			...(AsyncData.isFailure(windows) && !AsyncData.hasData(windows)
				? [
						h.div(
							[
								h.Class(
									"flex items-center justify-between gap-3 border-border border-t px-4 py-3 text-muted-fg text-sm sm:px-5",
								),
							],
							["Couldn't load these metrics.", retryButton(h, context)],
						),
					]
				: widget.rows._tag === "group" && context.metrics === null
					? Array.from({ length: 4 }, (_, index) =>
							h.div(
								[
									h.Key(`skeleton-${index}`),
									h.AriaHidden(true),
									h.Class("flex h-12 items-center border-border border-t px-4 sm:px-5"),
								],
								[skeleton(h, "h-3 w-full")],
							),
						)
					: rows.length === 0
						? [
								h.p(
									[
										h.Class(
											"border-border border-t px-4 py-6 text-center text-muted-fg text-sm sm:px-5",
										),
									],
									[
										widget.rows._tag === "group"
											? `No metrics in the ${widget.rows.group} group yet.`
											: "No metrics picked.",
									],
								),
							]
						: rows.map(row)),
		],
	)
}

// GRID

const SPAN_CLASS = {
	1: "col-span-4 @md:col-span-2 @2xl:col-span-1",
	// By the grid's own width (a container), so the editor's canvas lays out like the tab.
	2: "col-span-4 @2xl:col-span-2",
	3: "col-span-4 @2xl:col-span-3",
	4: "col-span-4",
} as const satisfies Record<Customers.WidgetSpan, string>

/** The health breakdown's table needs more room than the other sections before it shares a row. */
export const spanClass = (widget: Customers.OverviewWidget): string =>
	widget._tag === "built_in" && widget.kind === "health" && widget.span < 4
		? widget.span === 2
			? "col-span-4 @5xl:col-span-2"
			: "col-span-4 @5xl:col-span-3"
		: SPAN_CLASS[widget.span]

/** One widget; null for a stat hidden for this customer. */
export const widgetView = <M>(
	h: HtmlBuilder<M>,
	widget: Customers.OverviewWidget,
	context: WidgetContext<M>,
): Html | null =>
	Match.valueTags(widget, {
		stat: (stat) => statView(h, stat, context),
		chart: (chart) => chartView(h, chart, context),
		metric_table: (table) => tableView(h, table, context),
		built_in: (builtIn) => builtInView(h, builtIn, context.builtIn),
	})

/**
 * The 4-column grid (container-sized, so the editor's narrower canvas lays out like the page).
 * `wrap` puts each drawn widget in a frame of the caller's (the editor's selection).
 */
export const widgetGrid = <M>(
	h: HtmlBuilder<M>,
	widgets: ReadonlyArray<Customers.OverviewWidget>,
	context: WidgetContext<M>,
	wrap?: (widget: Customers.OverviewWidget, index: number, drawn: Html) => Html,
): Html =>
	h.div(
		[h.Class("@container")],
		[
			h.div(
				[h.Class("grid grid-cols-4 gap-4")],
				widgets.flatMap((widget, index) => {
					const drawn = widgetView(h, widget, context)
					return drawn === null
						? []
						: [
								h.div(
									[h.Key(widget.id), h.Class(twMerge("min-w-0", spanClass(widget)))],
									[wrap === undefined ? drawn : wrap(widget, index, drawn)],
								),
							]
				}),
			),
		],
	)
