import type { Html, HtmlBuilder } from "foldkit/html"
import * as AsyncData from "foldkit/asyncData"
import { Option } from "effect"
import { twMerge } from "tailwind-merge"
import { formatCount, formatDate, formatRelative } from "../../../../customers/format"
import { SUGGESTED_METRICS } from "../../../../customers/suggested-metrics"
import { IconChartBar, IconPlus, IconWarning } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import { link } from "../../../../ui/link"
import { loader } from "../../../../ui/loader"
import type { Shared } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { layoutsUsing } from "./form"
import { Message } from "./message"
import type { CoverageRow, MetricRow, Model } from "./model"
import { formatLabelOf, keyText, SOURCE_KIND_LABEL, sourceLabelOf } from "./parts"

/** The metrics catalog (Wonder "Metrics Settings"): every metric by group, what feeds it, and who has data. */

type H = HtmlBuilder<Message>

const COLUMNS =
	"grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 @3xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_5.5rem_minmax(0,1fr)_8rem]"

const headerRow = (h: H): Html =>
	h.div(
		[
			h.AriaHidden(true),
			h.Class(twMerge(COLUMNS, "h-9 border-border border-b font-medium text-muted-fg text-xs")),
		],
		[
			h.span([], ["Metric"]),
			h.span([h.Class("hidden @3xl:block")], ["Source"]),
			h.span([h.Class("hidden @3xl:block")], ["Unit"]),
			h.span([h.Class("hidden text-right @3xl:block")], ["Customers"]),
			h.span([h.Class("hidden @3xl:block")], ["Used in"]),
			h.span([h.Class("text-right")], ["Last run"]),
		],
	)

/** Customers with data in the last 30 days; formulas are evaluated, never stored. */
const customersCell = (h: H, metric: MetricRow, coverage: Model["coverage"]): Html => {
	const text =
		metric.source?._tag === "formula"
			? "—"
			: AsyncData.matchData(coverage, {
					onEmpty: () => "…",
					onFailure: () => "—",
					onData: (rows) => formatCount(coverageOf(rows, metric.key)?.accountsWithData ?? 0),
				})
	return h.span([h.Class("hidden text-right text-fg text-sm tabular-nums @3xl:block")], [text])
}

const coverageOf = (rows: ReadonlyArray<CoverageRow>, key: string): CoverageRow | undefined =>
	rows.find((row) => row.metricKey === key)

/** A Maple query's last run (a failure in red); else the latest day with data. */
const lastRunCell = (h: H, metric: MetricRow, model: Model, nowMs: number): Html => {
	const now = new Date(nowMs)
	if (metric.lastError !== null)
		return h.span(
			[
				h.Class(
					"inline-flex items-center justify-end gap-1 whitespace-nowrap text-danger-subtle-fg text-sm",
				),
				h.Title(metric.lastError),
			],
			[
				IconWarning(h, { className: "size-3.5 shrink-0" }),
				metric.lastRunAtMs === null
					? "Failed"
					: `Failed ${formatRelative(new Date(metric.lastRunAtMs), now)}`,
			],
		)
	const lastDay = Option.match(AsyncData.getData(model.coverage), {
		onNone: () => null,
		onSome: (rows) => coverageOf(rows, metric.key)?.lastDay ?? null,
	})
	return h.span(
		[h.Class("whitespace-nowrap text-right text-muted-fg text-sm tabular-nums")],
		[
			metric.lastRunAtMs !== null
				? formatRelative(new Date(metric.lastRunAtMs), now)
				: lastDay !== null
					? `Data ${formatDate(new Date(`${lastDay}T00:00:00Z`), { now })}`
					: "—",
		],
	)
}

const usedInText = (count: ReadonlyArray<{ readonly name: string }>): string =>
	count.length === 0
		? "Not used"
		: count.length <= 2
			? count.map((layout) => layout.name).join(", ")
			: `${count.length} layouts`

const metricRow = (h: H, model: Model, metric: MetricRow, shared: Shared): Html => {
	const usedIn = layoutsUsing(model.layouts, model.metrics ?? [], metric.key)
	return h.li(
		[
			h.Key(metric.key),
			h.Class(twMerge(COLUMNS, "relative min-h-14 py-2.5 transition-colors hover:bg-secondary/40")),
		],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					h.a(
						[
							h.Href(
								hrefOf(
									AppRoute.CustomersSettingsMetric({
										orgSlug: shared.orgSlug ?? "",
										metricKey: metric.key,
									}),
								),
							),
							h.Class(
								"truncate font-medium text-fg text-sm outline-hidden after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/70",
							),
						],
						[metric.name],
					),
					keyText(h, metric.key),
					...(metric.lastError === null
						? []
						: [
								h.span(
									[h.Class("line-clamp-2 text-danger-subtle-fg text-xs")],
									[metric.lastError],
								),
							]),
				],
			),
			h.span([h.Class("hidden truncate text-fg-2 text-sm @3xl:block")], [sourceLabelOf(metric)]),
			h.span([h.Class("hidden truncate text-fg-2 text-sm @3xl:block")], [formatLabelOf(metric)]),
			customersCell(h, metric, model.coverage),
			h.span(
				[
					h.Class(
						twMerge(
							"hidden truncate text-sm @3xl:block",
							usedIn.length === 0 ? "text-muted-fg" : "text-fg-2",
						),
					),
				],
				[usedInText(usedIn)],
			),
			lastRunCell(h, metric, model, shared.nowMs),
		],
	)
}

const section = (
	h: H,
	model: Model,
	title: string,
	metrics: ReadonlyArray<MetricRow>,
	shared: Shared,
): Html =>
	h.section(
		[h.AriaLabel(title)],
		[
			h.div(
				[h.Class("flex h-9 items-center gap-2 border-border border-b bg-secondary/30 px-4 text-sm")],
				[
					h.span([h.Class("font-medium text-fg")], [title]),
					h.span([h.Class("text-muted-fg tabular-nums")], [formatCount(metrics.length)]),
				],
			),
			h.ul(
				[h.Class("divide-y divide-border")],
				metrics.map((metric) => metricRow(h, model, metric, shared)),
			),
		],
	)

/** Named groups by name, then the org's ungrouped metrics, then the built-ins. */
const sectionsOf = (
	metrics: ReadonlyArray<MetricRow>,
): ReadonlyArray<readonly [title: string, metrics: ReadonlyArray<MetricRow>]> => {
	const own = metrics.filter((metric) => !metric.builtIn)
	const groups = [...new Set(own.flatMap((metric) => (metric.group === null ? [] : [metric.group])))].sort(
		(a, b) => a.localeCompare(b),
	)
	const sections: ReadonlyArray<readonly [string, ReadonlyArray<MetricRow>]> = [
		...groups.map((group) => [group, own.filter((metric) => metric.group === group)] as const),
		["Other", own.filter((metric) => metric.group === null)],
		["Built-in", metrics.filter((metric) => metric.builtIn)],
	]
	return sections.filter(([, rows]) => rows.length > 0)
}

/** No metric of the org's own yet: the suggested ones, each a click from its prefilled editor. */
const suggestions = (h: H, shared: Shared, isAdmin: boolean): Html =>
	emptyState(h, {
		title: "No metrics of your own yet",
		icon: (className) => IconChartBar(h, { className }),
		description:
			"Define a daily value per customer from a Maple query, product events or a formula. Start from one of these:",
		className: "rounded-xl border border-border bg-bg",
		action: h.ul(
			[h.Class("flex max-w-2xl flex-wrap justify-center gap-2")],
			SUGGESTED_METRICS.map((suggested) =>
				h.li(
					[h.Key(suggested.key)],
					[
						link(
							h,
							{
								href: hrefOf(
									AppRoute.CustomersSettingsMetricNew({
										orgSlug: shared.orgSlug ?? "",
										key: Option.some(suggested.key),
										source: Option.none(),
									}),
								),
								isDisabled: !isAdmin,
								className:
									"inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-fg text-sm no-underline hover:bg-secondary",
							},
							[
								suggested.draft.name,
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[
										suggested.draft.source === null
											? ""
											: SOURCE_KIND_LABEL[suggested.draft.source._tag],
									],
								),
							],
						),
					],
				),
			),
		),
	})

export const listView = (h: H, model: Model, shared: Shared): Html => {
	const isAdmin = isCustomersAdmin(shared)
	const metrics = model.metrics
	const hasOwn = metrics?.some((metric) => metric.source !== null) ?? false
	return settingsPage(h, [
		settingsHeader(h, {
			title: "Metrics",
			subtitle:
				"A daily value per customer, pulled from your sources or defined here. Overview layouts and signals read from these.",
			actions: isAdmin
				? [
						button(h, { onPress: Message.PressedNewMetric() }, [
							IconPlus(h, { attributes: { "data-slot": "icon" } }),
							"New metric",
						]),
					]
				: [],
		}),
		...(isAdmin ? [] : [readOnlyNotice(h, "metrics")]),
		...(metrics === null
			? [h.div([h.Class("flex justify-center py-16")], [loader(h, { ariaLabel: "Loading metrics" })])]
			: [
					...(hasOwn ? [] : [suggestions(h, shared, isAdmin)]),
					h.div(
						[h.Class("@container overflow-hidden rounded-xl border border-border bg-bg")],
						[
							headerRow(h),
							...sectionsOf(metrics).map(([title, rows]) =>
								section(h, model, title, rows, shared),
							),
						],
					),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						[
							"Customers counts who had a value in the last 30 days. Maple queries run with every Maple sync and fill their history when saved.",
						],
					),
				]),
	])
}
