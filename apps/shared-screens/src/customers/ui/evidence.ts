// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A signal's evidence by its `_tag` (today's `web-foldkit/src/customers/ui/evidence.ts`): the queue
 * row's mini-viz (`evidenceViz`) and the side panel's facts with a chart (`evidenceDetail`).
 */
import {
	type LimitForecast,
	overdueLabel,
	type SeriesPoint,
	type SignalEvidence,
} from "@hazel/domain/customers"
import type { Content, Hazel } from "@hazel/ui/vocabulary/index"
import { Match } from "effect"
import { NO_VALUE } from "./badges"
import {
	formatCompact,
	formatCount,
	formatDate,
	formatDay,
	formatDays,
	formatDaysLeft,
	formatDeltaPct,
	formatMetricValue,
	formatMoney,
	formatPct,
	type Instant,
} from "../data/format"

type Of<Tag extends SignalEvidence["_tag"]> = Extract<SignalEvidence, { _tag: Tag }>

const deltaValue = (evidence: Of<"delta">, value: number): string =>
	evidence.unit === "minor" ? formatMoney(value, evidence.currency ?? "USD") : formatCount(value)

/** `$1,240 → $0`, `8 → 20 users`, or the labels (`Scale → Growth`) when set. */
export const deltaSummary = (evidence: Of<"delta">): string =>
	evidence.fromLabel !== null && evidence.toLabel !== null
		? `${evidence.fromLabel} → ${evidence.toLabel}`
		: `${deltaValue(evidence, evidence.from)} → ${deltaValue(evidence, evidence.to)}${evidence.unit === "minor" ? "" : " users"}`

/** One series in a chart's terms: a value per day, in the tone of its direction. */
const seriesOf = (
	key: string,
	label: string,
	points: ReadonlyArray<SeriesPoint>,
	falling: boolean,
): Readonly<{ series: ReadonlyArray<Content.ChartSeries>; labels: ReadonlyArray<string> }> => ({
	series: [{ key, label, tone: falling ? "churn" : "new", values: points.map((point) => point.value) }],
	labels: points.map((point) => formatDay(point.day)),
})

/** The inline sparkline with its end dot (W2b's `regular`). */
const sparkline = <Msg>(
	h: Hazel.H<Msg>,
	label: string,
	points: ReadonlyArray<SeriesPoint>,
	falling: boolean,
	size: "regular" | "large" = "regular",
) => {
	const { series, labels } = seriesOf("value", label, points, falling)
	return h.chart.kind("sparkline").size(size).label(label).series(series).labels(labels)
}

/** Two right-aligned lines: the figure, and what it means. */
const lines = <Msg>(h: Hazel.H<Msg>, top: string, bottom: string | null, danger = false) =>
	// HAZEL-GAP(pk0-evidence-lines): today's figure is 14px medium over a 12px caption, right-aligned; a stack's `end` aligns the lines but not their text, and a bottom-only danger tone needs its own run.
	h.stack
		.density("tight")
		.align("end")
		.children(
			h.text
				.strong()
				.numeric()
				.tone(danger ? "danger" : "default")
				.children(top),
			bottom === null ? null : h.text.role("caption").tone("muted").numeric().children(bottom),
		)

const limitMeter = <Msg>(h: Hazel.H<Msg>, evidence: Of<"limit">) =>
	// HAZEL-GAP(chart-meter): today's meter turns amber at the limit and red past 120%; `progress` is one tone.
	h.progress
		.value(Math.min(1, evidence.limit === 0 ? 1 : evidence.value / evidence.limit))
		.label(`${evidence.metricName}: ${formatPct(evidence.pct, { digits: 0 })} of limit`)

/** The queue row's evidence cell: one or two lines, or a sparkline or meter. */
export const evidenceViz = <Msg>(h: Hazel.H<Msg>, evidence: SignalEvidence) =>
	Match.valueTags(evidence, {
		amount: (evidence) =>
			evidence.daysOverdue > 0
				? h.stack
						.density("tight")
						.align("end")
						.children(
							h.text
								.strong()
								.numeric()
								.children(formatMoney(evidence.amountMinor, evidence.currency)),
							h.text
								.role("caption")
								.tone("danger")
								.numeric()
								.children(`${evidence.daysOverdue}d overdue`),
						)
				: lines(h, formatMoney(evidence.amountMinor, evidence.currency), "Due now"),
		last_active: (evidence) =>
			lines(
				h,
				`${formatDays(evidence.daysInactive)} quiet`,
				evidence.contactName ?? `was ${formatCount(evidence.priorActiveUsers)} active`,
			),
		series: (evidence) =>
			h.stack
				.axis("horizontal")
				.density("compact")
				.align("center")
				.children(
					sparkline(
						h,
						`${evidence.metricKey}: ${formatDeltaPct(evidence.changePct)} over ${evidence.recentDays} days`,
						evidence.series,
						evidence.changePct < 0,
					),
					h.text
						.role("caption")
						.numeric()
						.tone(evidence.changePct < 0 ? "danger" : "success")
						.children(formatDeltaPct(evidence.changePct)),
				),
		limit: (evidence) =>
			h.stack
				.density("compact")
				.align("end")
				.children(
					h.text
						.role("caption")
						.strong()
						.numeric()
						.children(`${formatCompact(evidence.value)} / ${formatCompact(evidence.limit)}`),
					limitMeter(h, evidence),
				),
		delta: (evidence) =>
			evidence.series.length >= 2 && evidence.unit !== "minor"
				? sparkline(h, deltaSummary(evidence), evidence.series, evidence.to < evidence.from)
				: lines(
						h,
						deltaSummary(evidence),
						evidence.changePct === null ? null : formatDeltaPct(evidence.changePct),
					),
		ratio: (evidence) =>
			lines(
				h,
				`${evidence.value} / ${evidence.target} ${evidence.unit === "users" ? "active" : "contacts"}`,
				evidence.daysLeft !== null
					? formatDaysLeft(evidence.daysLeft)
					: evidence.ageDays !== null
						? `${formatDays(evidence.ageDays)} old`
						: null,
			),
		overdue: (evidence) =>
			lines(
				h,
				`${overdueLabel(evidence.overdueMs)} overdue`,
				evidence.count === 1 ? "1 issue" : `${formatCount(evidence.count)} issues`,
				true,
			),
	})

/** One fact: its label, then its value at the row's end (today's `dl` row, `justify-between`). */
const fact = <Msg>(h: Hazel.H<Msg>, label: string, value: string, danger = false) =>
	// HAZEL-GAP(pk0-facts): `property` lays its label in a column (`detail/parts.ts`); today's facts are a justified `dl` row, drawn here as a stack without the `dt`/`dd` semantics.
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			h.text.tone("muted").children(label),
			h.spacer,
			h.text
				.numeric()
				.tone(danger ? "danger" : "default")
				.children(value),
		)

/** Where a metered feature lands at its current pace. */
const forecastFacts = <Msg>(h: Hazel.H<Msg>, forecast: LimitForecast) => [
	fact(
		h,
		`Projected by ${formatDay(forecast.day)}`,
		`${formatMetricValue(forecast.value, null)} · ${formatPct(forecast.pct, { digits: 0 })}`,
	),
	fact(
		h,
		`Pace, last ${formatDays(forecast.days)}`,
		`${forecast.perDay >= 0 ? "+" : "−"}${formatMetricValue(Math.abs(forecast.perDay), null)} / day`,
	),
	forecast.limitDay === null ? null : fact(h, "Reaches limit", formatDay(forecast.limitDay)),
]

/** The side panel's evidence: the numbers as facts, with a chart where the evidence has a series. */
export const evidenceDetail = <Msg>(
	h: Hazel.H<Msg>,
	evidence: SignalEvidence,
	options: Readonly<{ now: Instant }>,
) => {
	const date = (at: string | null) =>
		at === null ? NO_VALUE : formatDate(new Date(at), { now: options.now })
	type Entry = ReturnType<typeof fact<Msg>> | null
	const facts = (entries: ReadonlyArray<Entry>, chart?: Hazel.NoTextInput<Msg>) =>
		h.stack.children(chart ?? null, h.stack.density("compact").children(...entries))
	return Match.valueTags(evidence, {
		amount: (evidence) =>
			facts([
				fact(h, "Amount due", formatMoney(evidence.amountMinor, evidence.currency, { cents: true })),
				evidence.daysOverdue > 0
					? fact(h, "Overdue", formatDays(evidence.daysOverdue), true)
					: fact(h, "Overdue", "Not yet"),
				evidence.invoiceNumber ? fact(h, "Invoice", evidence.invoiceNumber) : null,
				evidence.attemptCount !== null
					? fact(h, "Payment attempts", String(evidence.attemptCount))
					: null,
				evidence.declineReason ? fact(h, "Decline reason", evidence.declineReason) : null,
				evidence.nextRetryAt ? fact(h, "Next retry", date(evidence.nextRetryAt)) : null,
			]),
		last_active: (evidence) =>
			facts([
				evidence.contactName ? fact(h, "Champion", evidence.contactName) : null,
				evidence.contactEmail ? fact(h, "Email", evidence.contactEmail) : null,
				fact(h, "Last active", date(evidence.lastActiveAt)),
				fact(h, "Quiet for", formatDays(evidence.daysInactive)),
				fact(h, "Active users before", formatCount(evidence.priorActiveUsers)),
			]),
		series: (evidence) => {
			const label = `${evidence.metricKey} by day: ${formatDeltaPct(evidence.changePct)} against the prior ${evidence.baselineDays}-day average`
			const { series, labels } = seriesOf(
				"usage",
				evidence.metricKey,
				evidence.series,
				evidence.changePct < 0,
			)
			return facts(
				[
					fact(
						h,
						`Last ${evidence.recentDays} days avg`,
						formatCount(Math.round(evidence.recentAvg)),
					),
					fact(
						h,
						`Prior ${evidence.baselineDays} days avg`,
						formatCount(Math.round(evidence.baselineAvg)),
					),
					fact(h, "Change", formatDeltaPct(evidence.changePct)),
				],
				// W2b's `chart-baseline`: `net` dashes the mean of the bars before `highlightFrom`.
				h.chart
					.kind("barSparkline")
					.label(label)
					.series(series)
					.labels(labels)
					.highlightFrom(Math.max(0, evidence.series.length - evidence.recentDays))
					.net(),
			)
		},
		limit: (evidence) =>
			facts(
				[
					fact(
						h,
						evidence.metricName,
						`${formatMetricValue(evidence.value, null)} / ${formatMetricValue(evidence.limit, null)}`,
					),
					fact(h, "Of limit", formatPct(evidence.pct, { digits: 0 })),
					...(evidence.forecast == null ? [] : forecastFacts(h, evidence.forecast)),
				],
				limitMeter(h, evidence),
			),
		delta: (evidence) =>
			facts(
				[
					fact(h, "Change", deltaSummary(evidence)),
					evidence.changePct === null
						? null
						: fact(h, "Percent", formatDeltaPct(evidence.changePct)),
					evidence.effectiveAt ? fact(h, "Takes effect", date(evidence.effectiveAt)) : null,
					evidence.reason ? fact(h, "Reason", evidence.reason) : null,
				],
				evidence.series.length >= 2
					? sparkline(
							h,
							deltaSummary(evidence),
							evidence.series,
							evidence.to < evidence.from,
							"large",
						)
					: undefined,
			),
		ratio: (evidence) =>
			facts([
				fact(
					h,
					evidence.unit === "users" ? "Active users" : "Active contacts",
					`${evidence.value} of ${evidence.target} needed`,
				),
				evidence.deadline ? fact(h, "Trial ends", date(evidence.deadline)) : null,
				evidence.daysLeft !== null ? fact(h, "Time left", formatDaysLeft(evidence.daysLeft)) : null,
				evidence.ageDays !== null ? fact(h, "Account age", formatDays(evidence.ageDays)) : null,
			]),
		overdue: (evidence) =>
			facts([
				fact(h, evidence.count === 1 ? "Issue" : "Most overdue", evidence.issueTitle),
				fact(
					h,
					evidence.clock === "reply" ? "Reply was due" : "Resolution was due",
					date(evidence.dueAt),
				),
				fact(h, "Overdue by", overdueLabel(evidence.overdueMs), true),
				evidence.count > 1 ? fact(h, "Overdue issues", formatCount(evidence.count)) : null,
			]),
	})
}
