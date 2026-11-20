import type * as Customers from "@hazel/domain/customers"
import { CustomerAccountId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { commonMessage } from "~/lib/error-messages"
import { stackedBarChart } from "../../../customers/charts/stacked-bar-chart"
import { chartCard } from "../../../customers/charts/frame"
import { formatCount, formatDay, formatDayLong } from "../../../customers/format"
import { formatSlaDuration } from "../../../customers/sla"
import { formatResponse, formatWithin, supportTiles } from "../../../customers/support-report"
import { type Column, dataTable, primaryCell } from "../../../customers/ui/data-table"
import { rangePicker, segmented } from "../../../customers/ui/filter-bar"
import { companyLogo } from "../../../customers/ui/identity"
import { kpiTile } from "../../../customers/ui/kpi-tile"
import { pageHeader, panel, panelClass, panelHeader, titleClass } from "../../../customers/ui/surface"
import { IconArrowPath, IconSupport } from "../../../icons"
import { AppRoute, customerRoute, hrefOf } from "../../../route"
import { button, buttonClassName } from "../../../ui/button"
import { heading } from "../../../ui/heading"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import { type DailyChart, isEmptyReport, type Model } from "./model"

/** The Support report page: tiles, a daily chart, and the by-account and by-policy tables. */

type Report = Customers.SupportReport
type Row = Customers.SupportReportRow

const RANGE_LABEL = {
	"7d": "the last 7 days",
	"30d": "the last 30 days",
	"90d": "the last 90 days",
	"12m": "the last 12 months",
} as const satisfies Record<Customers.CustomersRange, string>

const toRange = (range: Customers.CustomersRange) => Message.ClickedRange({ range })
const toChart = (chart: DailyChart) => Message.ClickedChart({ chart })
const toHover = (index: number | null) => Message.HoveredDay({ index })

// HEADER

const header = (h: HtmlBuilder<Message>, model: Model, report: Report | undefined, orgSlug: string): Html =>
	pageHeader(h, {
		title: "Support report",
		subtitle:
			report === undefined
				? "First response, resolution and SLA breaches"
				: `${formatCount(report.issues)} issue${report.issues === 1 ? "" : "s"} opened under an SLA in ${RANGE_LABEL[model.range]}`,
		actions: [
			rangePicker(h, { selected: model.range, onSelect: toRange, caption: null }),
			h.a(
				[
					h.Href(hrefOf(AppRoute.CustomersSettingsSla({ orgSlug }))),
					h.Class(buttonClassName({ intent: "outline", size: "sm" })),
				],
				["SLA settings"],
			),
		],
	})

// TILES

const tileGrid = (h: HtmlBuilder<Message>, tiles: ReadonlyArray<Html>): Html =>
	h.div([h.Class("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6")], [...tiles])

const tiles = (h: HtmlBuilder<Message>, report: Report | undefined): Html =>
	tileGrid(h, [
		...supportTiles(h, { report, idPrefix: "support" }),
		...(report === undefined
			? ["Median resolution", "Resolved within SLA"].map((label) =>
					kpiTile(h, { id: `support-${label}`, label, state: "loading" }),
				)
			: [
					kpiTile(h, {
						id: "support-resolution",
						label: "Median resolution",
						definition:
							"Half the issues resolved in the range closed within this much working time, pauses left out.",
						value: formatResponse(report.resolution.medianMs),
						detail:
							report.resolution.count === 0
								? undefined
								: `${formatCount(report.resolution.count)} resolved`,
					}),
					kpiTile(h, {
						id: "support-resolution-within",
						label: "Resolved within SLA",
						definition:
							"Share of resolved issues closed before their policy's resolution target.",
						value: formatWithin(report.resolution.withinPct),
					}),
				]),
	])

// CHART

const CHART_SEGMENTS = [
	{ key: "median", label: "Median" },
	{ key: "within", label: "Within SLA" },
] as const

/** Hours on the axis: `0`, `30m`, `1h`, `1.5h`. */
const axisHours = (hours: number): string =>
	hours === 0 ? "0" : hours < 1 ? `${Math.round(hours * 60)}m` : `${Math.round(hours * 10) / 10}h`

const dailyCard = (h: HtmlBuilder<Message>, model: Model, report: Report): Html => {
	const isMedian = model.chart === "median"
	const bars = report.daily.map((day) => {
		const value = isMedian
			? day.firstResponseMedianMs === null
				? 0
				: day.firstResponseMedianMs / 3_600_000
			: day.withinPct === null
				? 0
				: day.withinPct * 100
		return {
			tick: formatDay(day.day),
			heading: `${formatDayLong(day.day)} · ${day.issues === 0 ? "no issues" : `${formatCount(day.issues)} opened`}`,
			values: { value },
			net: value,
		}
	})
	return chartCard(
		h,
		{
			title: "First response by day",
			description: isMedian
				? "Median working time to the first team reply, by the day issues opened"
				: "Share of first replies within target, by the day issues opened",
			aside: segmented(h, {
				ariaLabel: "Chart",
				segments: CHART_SEGMENTS,
				selected: model.chart,
				onSelect: toChart,
			}),
		},
		[
			stackedBarChart(h, {
				ariaLabel: isMedian
					? `Median first response by day: ${formatResponse(report.firstResponse.medianMs)} over the range`
					: `First replies within SLA by day: ${formatWithin(report.firstResponse.withinPct)} over the range`,
				stacks: [
					{
						key: "value",
						label: isMedian ? "Median first response" : "Within SLA",
						color: isMedian ? "series-1" : "series-2",
					},
				],
				bars,
				formatValue: isMedian
					? (hours) => (hours === 0 ? "—" : formatSlaDuration(hours * 3_600_000))
					: (pct) => `${Math.round(pct)}%`,
				formatAxis: isMedian ? axisHours : (pct) => `${Math.round(pct)}%`,
				hoveredIndex: model.hoveredDay,
				onHover: toHover,
				maxXTicks: 6,
				heightClass: "h-48",
			}),
		],
	)
}

// TABLES

const numberCell = <M>(h: HtmlBuilder<M>, value: string, className?: string): Html =>
	h.span([h.Class(twMerge("whitespace-nowrap tabular-nums", className))], [value])

const breachesCell = <M>(h: HtmlBuilder<M>, breaches: number): Html =>
	numberCell(h, formatCount(breaches), breaches > 0 ? "font-medium text-danger-subtle-fg" : "text-muted-fg")

const withinCell = <M>(h: HtmlBuilder<M>, share: number | null): Html =>
	numberCell(
		h,
		formatWithin(share),
		share === null ? "text-muted-fg" : share < 0.8 ? "text-warning-subtle-fg" : undefined,
	)

const decodeAccountId = Schema.decodeUnknownOption(CustomerAccountId)

const accountColumns = (h: HtmlBuilder<Message>, orgSlug: string): ReadonlyArray<Column<Row>> => [
	{
		key: "account",
		label: "Account",
		cell: (row) =>
			primaryCell(h, {
				leading: companyLogo(h, { name: row.label, size: "sm" }),
				title: row.label,
				href: Option.getOrUndefined(
					Option.map(decodeAccountId(row.key), (accountId) =>
						hrefOf(customerRoute(orgSlug, accountId)),
					),
				),
			}),
	},
	{
		key: "issues",
		label: "Issues",
		align: "right",
		widthClass: "w-20",
		cell: (row) => numberCell(h, formatCount(row.issues)),
	},
	{
		key: "median",
		label: "Median first response",
		align: "right",
		widthClass: "w-44",
		hideClass: "max-sm:hidden",
		cell: (row) => numberCell(h, formatResponse(row.firstResponse.medianMs)),
	},
	{
		key: "p90",
		label: "P90",
		align: "right",
		widthClass: "w-28",
		hideClass: "max-lg:hidden",
		cell: (row) => numberCell(h, formatResponse(row.firstResponse.p90Ms)),
	},
	{
		key: "within",
		label: "Within SLA",
		align: "right",
		widthClass: "w-28",
		hideClass: "max-md:hidden",
		cell: (row) => withinCell(h, row.firstResponse.withinPct),
	},
	{
		key: "breaches",
		label: "Breaches",
		align: "right",
		widthClass: "w-24",
		cell: (row) => breachesCell(h, row.breaches),
	},
]

const policyColumns = (h: HtmlBuilder<Message>): ReadonlyArray<Column<Row>> => [
	{ key: "policy", label: "Policy", cell: (row) => primaryCell(h, { title: row.label }) },
	{
		key: "issues",
		label: "Issues",
		align: "right",
		widthClass: "w-20",
		cell: (row) => numberCell(h, formatCount(row.issues)),
	},
	{
		key: "median",
		label: "Median first response",
		align: "right",
		widthClass: "w-44",
		hideClass: "max-sm:hidden",
		cell: (row) => numberCell(h, formatResponse(row.firstResponse.medianMs)),
	},
	{
		key: "within",
		label: "Within SLA",
		align: "right",
		widthClass: "w-28",
		hideClass: "max-md:hidden",
		cell: (row) => withinCell(h, row.firstResponse.withinPct),
	},
	{
		key: "resolution",
		label: "Median resolution",
		align: "right",
		widthClass: "w-36",
		hideClass: "max-lg:hidden",
		cell: (row) => numberCell(h, formatResponse(row.resolution.medianMs)),
	},
	{
		key: "breaches",
		label: "Breaches",
		align: "right",
		widthClass: "w-24",
		cell: (row) => breachesCell(h, row.breaches),
	},
]

const tableCard = (
	h: HtmlBuilder<Message>,
	options: Readonly<{ title: string; description: string; table: Html }>,
): Html =>
	panel(h, "gap-3 px-0 pb-0 sm:px-0 sm:pb-0", [
		panelHeader(h, {
			title: options.title,
			description: options.description,
			className: "px-4 sm:px-5",
		}),
		options.table,
	])

// STATES

const failure = (h: HtmlBuilder<Message>, reason: Parameters<typeof commonMessage>[0]): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Class(twMerge("flex flex-col items-center gap-3 px-6 py-14 text-center", panelClass))],
		[
			h.span([h.Class(titleClass)], ["Couldn't load the Support report"]),
			h.span([h.Class("max-w-sm text-muted-fg text-sm")], [message.description ?? message.title]),
			button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetry() }, [
				IconArrowPath(h, { attributes: { "data-slot": "icon" } }),
				"Try again",
			]),
		],
	)
}

const empty = (h: HtmlBuilder<Message>, model: Model, orgSlug: string): Html =>
	h.div(
		[h.Class("flex flex-col items-center gap-4 rounded-xl border border-border px-6 py-14 text-center")],
		[
			h.div(
				[h.Class("flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-fg")],
				[IconSupport(h, { className: "size-5" })],
			),
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					heading(h, { variant: "subsection", level: 2 }, ["No support issues in this range"]),
					h.p(
						[h.Class("max-w-sm text-muted-fg text-sm")],
						[
							`No issue under an SLA policy opened in ${RANGE_LABEL[model.range]}. Policies decide which customers' issues are timed.`,
						],
					),
				],
			),
			h.a(
				[
					h.Href(hrefOf(AppRoute.CustomersSettingsSla({ orgSlug }))),
					h.Class(buttonClassName({ intent: "outline", size: "sm" })),
				],
				["Open SLA settings"],
			),
		],
	)

const content = (h: HtmlBuilder<Message>, model: Model, orgSlug: string): ReadonlyArray<Html> => {
	const report = Option.getOrUndefined(AsyncData.getData(model.report))
	const failed = AsyncData.getError(model.report)
	if (report === undefined && failed._tag === "Some") return [failure(h, failed.value)]
	if (report === undefined)
		return [
			tiles(h, undefined),
			h.div([h.Class("h-72 animate-pulse rounded-xl border border-border bg-secondary/30")]),
		]
	if (isEmptyReport(report)) return [empty(h, model, orgSlug)]
	return [
		tiles(h, report),
		dailyCard(h, model, report),
		tableCard(h, {
			title: "By account",
			description: "Most breaches first",
			table: dataTable(h, {
				ariaLabel: "Support by account",
				id: "support-accounts",
				columns: accountColumns(h, orgSlug),
				rows: report.byAccount,
				rowKey: (row) => row.key,
				className: "rounded-none rounded-b-xl border-x-0 border-b-0",
			}),
		}),
		tableCard(h, {
			title: "By policy",
			description: "Each issue counts under the policy it started with",
			table: dataTable(h, {
				ariaLabel: "Support by policy",
				id: "support-policies",
				columns: policyColumns(h),
				rows: report.byPolicy,
				rowKey: (row) => row.key,
				className: "rounded-none rounded-b-xl border-x-0 border-b-0",
			}),
		}),
	]
}

// PAGE

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const orgSlug = shared.orgSlug ?? ""
	const report = Option.getOrUndefined(AsyncData.getData(model.report))
	return h.div(
		[h.Class("h-full overflow-y-auto")],
		[
			h.div(
				[h.Class("mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8")],
				[header(h, model, report, orgSlug), ...content(h, model, orgSlug)],
			),
		],
	)
})
