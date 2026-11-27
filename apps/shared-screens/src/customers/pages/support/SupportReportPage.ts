// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$org/customers/support` (today's `web-foldkit/src/page/customers/support`, now deleted): first
 * response, resolution and SLA breaches for the issues opened in a range, by day, by account and by
 * policy (`docs/customers/sla.md` §4).
 */
import { Component, UiSchema } from "@effect/ui"
import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId } from "@hazel/schema"
import { type Content, Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Match, Option, Schema } from "effect"
import { Navigate } from "../../../app/requests"
import { Session } from "../../../app/session"
import { type CommonReason, commonCopy } from "../../../modals/feedback"
import { formatCount, formatDay, formatDayLong } from "../../data/format"
import { rangePicker } from "../../ui/filter-bar"
import { companyLogo } from "../../ui/identity"
import { kpiTile } from "../../ui/kpi-tile"
import { customersHref, pageHeader, panel, panelHeader } from "../parts"
import { formatResponse, formatWithin, GetSupportReport, isEmptyReport } from "./report"

type Report = Customers.SupportReport
type Row = Customers.SupportReportRow

/** What the daily chart plots: the median first response, or the share answered within target. */
export const DailyChart = Schema.Literals(["median", "within"])
export type DailyChart = typeof DailyChart.Type

export const SupportReportMessage = UiSchema.TaggedEnum({
	ClickedRange: { range: Customers.CustomersRange },
	ClickedChart: { chart: Schema.String },
	PressedRetry: {},
	PressedSlaSettings: {},
	PressedAccount: { accountId: CustomerAccountId },
})
export type SupportReportMessage = typeof SupportReportMessage.Type

export const SupportReportProps = Schema.Struct({
	session: Session,
	/** The shell's phone layout: the header's actions sit under its title. */
	isMobile: Schema.Boolean,
})
export type SupportReportProps = typeof SupportReportProps.Type

export const SupportReportModel = Schema.Struct({
	range: Customers.CustomersRange,
	chart: DailyChart,
	/** Counts "Try again": a failed report is fetched again under a new key. */
	attempt: Schema.Finite,
})
export type SupportReportModel = typeof SupportReportModel.Type

const RANGE_LABEL = {
	"7d": "the last 7 days",
	"30d": "the last 30 days",
	"90d": "the last 90 days",
	"12m": "the last 12 months",
} as const satisfies Record<Customers.CustomersRange, string>

const isChart = Schema.is(DailyChart)
const decodeAccountId = Schema.decodeUnknownOption(CustomerAccountId)

const SupportReportDef = Hazel.component({
	name: "SupportReportPage",
	props: SupportReportProps,
	model: SupportReportModel,
	message: SupportReportMessage,
	queries: {
		report: {
			query: GetSupportReport,
			args: ({ props, model }) =>
				props.session.organization === null
					? undefined
					: {
							organizationId: props.session.organization.id,
							range: model.range,
							attempt: model.attempt,
						},
		},
	},
})

type H = Parameters<Parameters<typeof SupportReportDef.make>[0]["view"]>[0]
type Child = Hazel.NoTextInput<SupportReportMessage>

// HEADER

const header = (h: H, model: SupportReportModel, report: Report | undefined) =>
	pageHeader(h, {
		title: "Support report",
		stacked: h.props.isMobile,
		subtitle:
			report === undefined
				? "First response, resolution and SLA breaches"
				: `${formatCount(report.issues)} issue${report.issues === 1 ? "" : "s"} opened under an SLA in ${RANGE_LABEL[model.range]}`,
		actions: [
			rangePicker(h, {
				selected: model.range,
				onSelect: (range) => SupportReportMessage.ClickedRange({ range }),
				caption: null,
			}),
			// HAZEL-GAP(p4-icon-link): today's "SLA settings" is a link drawn as an outline button.
			h.button
				.label("SLA settings")
				.variant("outline")
				.size("small")
				.on("press", SupportReportMessage.PressedSlaSettings()),
		],
	})

// TILES

const TILE_LABELS = [
	"Median first response",
	"P90 first response",
	"Within SLA",
	"Breaches",
	"Median resolution",
	"Resolved within SLA",
] as const

// HAZEL-GAP(pk1-grid-compact-columns): today's tiles are two columns on a phone (`grid-cols-2`); `grid` is one.
const tileGrid = (h: H, tiles: ReadonlyArray<Child>) =>
	h.grid
		.key("tiles")
		.columns("3")
		.density("cozy")
		.children(...tiles)

const tiles = (h: H, report: Report | undefined) => {
	if (report === undefined)
		return tileGrid(
			h,
			TILE_LABELS.map((label) => kpiTile(h, { label, state: "loading" }).key(label)),
		)
	const answered = report.firstResponse.count
	return tileGrid(h, [
		kpiTile(h, {
			label: "Median first response",
			definition:
				"Half the issues opened in the range had a first team reply within this much working time.",
			value: formatResponse(report.firstResponse.medianMs),
			detail: answered === 0 ? undefined : `${formatCount(answered)} answered`,
		}).key("median"),
		kpiTile(h, {
			label: "P90 first response",
			definition:
				"Nine in ten issues opened in the range had a first team reply within this much working time.",
			value: formatResponse(report.firstResponse.p90Ms),
		}).key("p90"),
		kpiTile(h, {
			label: "Within SLA",
			definition: "Share of first replies sent before their policy's first-response target.",
			value: formatWithin(report.firstResponse.withinPct),
			detail: "first response",
		}).key("within"),
		kpiTile(h, {
			label: "Breaches",
			definition:
				"Issues opened in the range that missed a target: answered or resolved late, or overdue now.",
			value: formatCount(report.breaches),
			detail: `${formatCount(report.overdueNow)} overdue now`,
		}).key("breaches"),
		kpiTile(h, {
			label: "Median resolution",
			definition:
				"Half the resolved issues opened in the range closed within this much working time, pauses left out.",
			value: formatResponse(report.resolution.medianMs),
			detail:
				report.resolution.count === 0
					? undefined
					: `${formatCount(report.resolution.count)} resolved`,
		}).key("resolution"),
		kpiTile(h, {
			label: "Resolved within SLA",
			definition:
				"Share of the resolved issues opened in the range closed before their policy's resolution target.",
			value: formatWithin(report.resolution.withinPct),
		}).key("resolution-within"),
	])
}

// CHART

const CHART_OPTIONS = [
	{ value: "median", label: "Median" },
	{ value: "within", label: "Within SLA" },
]

const dailyCard = (h: H, model: SupportReportModel, report: Report) => {
	const isMedian = model.chart === "median"
	// A day with no first reply has no bar (not a zero). A real 0% within SLA is drawn as a sliver.
	const values = report.daily.map((day) =>
		isMedian
			? day.firstResponseMedianMs
			: day.withinPct === null
				? null
				: Math.max(day.withinPct * 100, 0.4),
	)
	const headings = report.daily.map((day, index) => {
		const opened = day.issues === 0 ? "no issues" : `${formatCount(day.issues)} opened`
		const unanswered = values[index] === null && day.issues > 0
		return `${formatDayLong(day.day)} · ${unanswered ? `${opened}, no reply yet` : opened}`
	})
	const series: ReadonlyArray<Content.ChartSeries> = [
		{
			key: "value",
			label: isMedian ? "Median first response" : "Within SLA",
			tone: isMedian ? "series1" : "series2",
			values,
		},
	]
	return panel(h, "daily", [
		panelHeader(h, {
			title: "First response by day",
			descriptionTone: "muted",
			description: isMedian
				? "Median working time to the first team reply, by the day issues opened"
				: "Share of first replies within target, by the day issues opened",
			aside: h.choiceGroup
				.label("Chart")
				.labelHidden()
				.style("segmented")
				.options(CHART_OPTIONS)
				.selected([model.chart])
				.on("change", ({ selected }) =>
					SupportReportMessage.ClickedChart({ chart: selected[0] ?? model.chart }),
				),
		}),
		// HAZEL-GAP(chart-heights): today's plot is h-48; the user chose `regular` (h-56 for bars).
		h.chart
			.kind("stackedBar")
			.label(
				isMedian
					? `Median first response by day: ${formatResponse(report.firstResponse.medianMs)} over the range`
					: `First replies within SLA by day: ${formatWithin(report.firstResponse.withinPct)} over the range`,
			)
			.format(isMedian ? "duration" : "percent")
			.series(series)
			.labels(report.daily.map((day) => formatDay(day.day)))
			.headings(headings),
	])
}

// TABLES

type CellTone = "default" | "muted" | "warning" | "danger"

// HAZEL-GAP(pk1-cell-nowrap): today's number cells never wrap (`whitespace-nowrap`); a narrow column wraps `4h 20m`.
const numberCell = (h: H, value: string, tone: CellTone = "default") =>
	h.text
		.numeric()
		.tone(tone)
		.strong(tone === "danger")
		.children(value)

const breachesCell = (h: H, breaches: number) =>
	numberCell(h, formatCount(breaches), breaches > 0 ? "danger" : "muted")

const withinCell = (h: H, share: number | null) =>
	numberCell(h, formatWithin(share), share === null ? "muted" : share < 0.8 ? "warning" : "default")

const ACCOUNT_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "account", label: "Account", width: "fill" },
	{ key: "issues", label: "Issues", align: "end" },
	{ key: "median", label: "Median first response", align: "end", optional: true },
	{ key: "p90", label: "P90", align: "end", optional: true },
	{ key: "within", label: "Within SLA", align: "end", optional: true },
	{ key: "breaches", label: "Breaches", align: "end" },
]

const POLICY_COLUMNS: ReadonlyArray<Content.TableColumn> = [
	{ key: "policy", label: "Policy", width: "fill" },
	{ key: "issues", label: "Issues", align: "end" },
	{ key: "median", label: "Median first response", align: "end", optional: true },
	{ key: "within", label: "Within SLA", align: "end", optional: true },
	{ key: "resolution", label: "Median resolution", align: "end", optional: true },
	{ key: "breaches", label: "Breaches", align: "end" },
]

const cell = (h: H, column: string, content: Child) => h.tableCell.column(column).children(content)

const accountRow = (h: H, row: Row) => {
	const accountId = Option.getOrUndefined(decodeAccountId(row.key))
	// HAZEL-GAP(p4-link-quiet): today's account name is a `text-fg` link; here the row opens the account.
	const base = h.tableRow.key(row.key).title(row.label)
	const pressable =
		accountId === undefined ? base : base.on("press", SupportReportMessage.PressedAccount({ accountId }))
	return pressable.children(
		cell(
			h,
			"account",
			h.stack
				.axis("horizontal")
				.density("cozy")
				.align("center")
				.children(
					companyLogo(h, { name: row.label, size: "sm" }),
					h.text.strong().truncate().children(row.label),
				),
		),
		cell(h, "issues", numberCell(h, formatCount(row.issues))),
		cell(h, "median", numberCell(h, formatResponse(row.firstResponse.medianMs))),
		cell(h, "p90", numberCell(h, formatResponse(row.firstResponse.p90Ms))),
		cell(h, "within", withinCell(h, row.firstResponse.withinPct)),
		cell(h, "breaches", breachesCell(h, row.breaches)),
	)
}

const policyRow = (h: H, row: Row) =>
	h.tableRow
		.key(row.key)
		.title(row.label)
		.children(
			cell(h, "policy", h.text.strong().truncate().children(row.label)),
			cell(h, "issues", numberCell(h, formatCount(row.issues))),
			cell(h, "median", numberCell(h, formatResponse(row.firstResponse.medianMs))),
			cell(h, "within", withinCell(h, row.firstResponse.withinPct)),
			cell(h, "resolution", numberCell(h, formatResponse(row.resolution.medianMs))),
			cell(h, "breaches", breachesCell(h, row.breaches)),
		)

/** A titled card whose table runs edge to edge under a hairline; the header keeps the card's inset. */
const tableCard = (
	h: H,
	options: Readonly<{ key: string; title: string; description: string; table: Child }>,
) =>
	h.frame
		.key(options.key)
		.surface("flush")
		.children(
			h.stack
				.inset("page")
				.children(panelHeader(h, { title: options.title, description: options.description })),
			h.divider,
			options.table,
		)

// STATES

const failure = (h: H, cause: Cause.Cause<CommonReason>) => {
	const copy = commonCopy(Option.getOrElse(Cause.findErrorOption(cause), (): CommonReason => "Unexpected"))
	return h.frame.key("failure").children(
		h.emptyState
			.title("Couldn't load the Support report")
			.description(copy.description ?? copy.title)
			.action(
				h.button
					.label("Try again")
					.icon("refresh")
					.variant("outline")
					.size("small")
					.on("press", SupportReportMessage.PressedRetry()),
			),
	)
}

const empty = (h: H, model: SupportReportModel) =>
	h.frame
		.key("empty")
		.children(
			h.emptyState
				.title("No support issues in this range")
				.icon("support")
				.description(
					`No issue under an SLA policy opened in ${RANGE_LABEL[model.range]}, and none overdue. Policies decide which customers' issues are timed.`,
				)
				.action(
					h.button
						.label("Open SLA settings")
						.variant("outline")
						.size("small")
						.on("press", SupportReportMessage.PressedSlaSettings()),
				),
		)

const content = (h: H, model: SupportReportModel, report: Report): ReadonlyArray<Child> =>
	isEmptyReport(report)
		? [empty(h, model)]
		: [
				tiles(h, report),
				dailyCard(h, model, report),
				tableCard(h, {
					key: "accounts",
					title: "By account",
					description: "Most breaches first",
					table: h.table
						.label("Support by account")
						.columns(ACCOUNT_COLUMNS)
						.children(...report.byAccount.map((row) => accountRow(h, row))),
				}),
				tableCard(h, {
					key: "policies",
					title: "By policy",
					description: "Each issue counts under the policy it started with",
					table: h.table
						.label("Support by policy")
						.columns(POLICY_COLUMNS)
						.children(...report.byPolicy.map((row) => policyRow(h, row))),
				}),
			]

export const SupportReportPageNoDeps = SupportReportDef.make({
	init: () => ({ range: "30d", chart: "median", attempt: 0 }),
	update: {
		ClickedRange: ($, { range }) => (range === $.model.range ? $.model : $.evolve({ range })),
		ClickedChart: ($, { chart }) => (isChart(chart) ? $.evolve({ chart }) : $.model),
		PressedRetry: ($) => $.evolve({ attempt: (attempt) => attempt + 1 }),
		PressedSlaSettings: ($) =>
			$.run(Navigate.make({ href: customersHref($.props.session, "/settings/sla"), replace: false })),
		PressedAccount: ($, { accountId }) =>
			$.run(Navigate.make({ href: customersHref($.props.session, `/${accountId}`), replace: false })),
	},
	view: (h, model) => {
		const result = h.queries.report
		const report = result._tag === "Success" ? result.value : undefined
		const body = Match.value(result).pipe(
			Match.tag("Success", ({ value }) => content(h, model, value)),
			Match.tag("Failure", ({ cause }) => [failure(h, cause)]),
			Match.orElse(() => [
				tiles(h, undefined),
				panel(h, "loading", [h.chart.kind("stackedBar").loading()]),
			]),
		)
		return h.stack
			.key("customers-support")
			.density("loose")
			.children(header(h, model, report), ...body)
	},
})

/** The page with its report query, on the host's `HazelRpc`. */
export const SupportReportPage = SupportReportPageNoDeps.pipe(Component.provide(GetSupportReport.layer))
