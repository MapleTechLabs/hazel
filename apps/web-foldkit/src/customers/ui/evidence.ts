import type { SignalEvidence } from "@hazel/domain/customers"
import { Match } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { evidenceBars, meter, sparkline } from "../charts/sparkline"
import {
	formatCompact,
	formatCount,
	formatDate,
	formatDays,
	formatDaysLeft,
	formatDeltaPct,
	formatMoney,
	formatPct,
	type Instant,
} from "../format"

/**
 * A signal's evidence, drawn by its `_tag` (the `viz`): the queue row's mini-viz (`evidenceViz`)
 * and the side panel's fuller version with a chart (`evidenceDetail`).
 */

type Of<Tag extends SignalEvidence["_tag"]> = Extract<SignalEvidence, { _tag: Tag }>

const DELTA_UNIT_TEXT = { points: "pts", users: "users" } as const

const deltaValue = (evidence: Of<"delta">, value: number): string =>
	evidence.unit === "minor" ? formatMoney(value, evidence.currency ?? "USD") : formatCount(value)

/** `$1,240 → $0`, `62 → 48`, `8 → 20 users`, or the labels (`Scale → Growth`) when set. */
export const deltaSummary = (evidence: Of<"delta">): string =>
	evidence.fromLabel !== null && evidence.toLabel !== null
		? `${evidence.fromLabel} → ${evidence.toLabel}`
		: `${deltaValue(evidence, evidence.from)} → ${deltaValue(evidence, evidence.to)}${evidence.unit === "minor" ? "" : ` ${DELTA_UNIT_TEXT[evidence.unit]}`}`

const stack = <M>(
	h: HtmlBuilder<M>,
	top: Html | string,
	bottom: Html | string | null,
	className?: string,
): Html =>
	h.div(
		[h.Class(twMerge("flex min-w-0 flex-col items-end gap-0.5 text-right", className))],
		[
			h.span([h.Class("whitespace-nowrap font-medium text-fg text-sm tabular-nums")], [top]),
			...(bottom === null
				? []
				: [h.span([h.Class("whitespace-nowrap text-muted-fg text-xs tabular-nums")], [bottom])]),
		],
	)

const danger = <M>(h: HtmlBuilder<M>, text: string): Html =>
	h.span([h.Class("text-danger-subtle-fg")], [text])

/** The queue row's evidence cell: one or two lines, or a sparkline / meter, right-aligned. */
export const evidenceViz = <M>(
	h: HtmlBuilder<M>,
	evidence: SignalEvidence,
	options: Readonly<{ className?: string }> = {},
): Html => {
	return Match.valueTags(evidence, {
		amount: (evidence) =>
			stack(
				h,
				formatMoney(evidence.amountMinor, evidence.currency),
				evidence.daysOverdue > 0 ? danger(h, `${evidence.daysOverdue}d overdue`) : "Due now",
				options.className,
			),
		last_active: (evidence) =>
			stack(
				h,
				`${formatDays(evidence.daysInactive)} quiet`,
				evidence.contactName ?? `was ${formatCount(evidence.priorActiveUsers)} active`,
				options.className,
			),
		series: (evidence) =>
			h.div(
				[h.Class(twMerge("flex items-center justify-end gap-2", options.className))],
				[
					sparkline(h, {
						values: evidence.series.map((point) => point.value),
						ariaLabel: `${evidence.metricKey}: ${formatDeltaPct(evidence.changePct)} over ${evidence.recentDays} days`,
						tone: evidence.changePct < 0 ? "negative" : "positive",
						endDot: true,
					}),
					h.span(
						[
							h.Class(
								twMerge(
									"text-xs tabular-nums",
									evidence.changePct < 0
										? "text-danger-subtle-fg"
										: "text-success-subtle-fg",
								),
							),
						],
						[formatDeltaPct(evidence.changePct)],
					),
				],
			),
		limit: (evidence) =>
			h.div(
				[h.Class(twMerge("flex flex-col items-end gap-1.5", options.className))],
				[
					h.span(
						[h.Class("whitespace-nowrap font-medium text-fg text-xs tabular-nums")],
						[`${formatCompact(evidence.value)} / ${formatCompact(evidence.limit)}`],
					),
					meter(h, {
						value: evidence.value,
						limit: evidence.limit,
						ariaLabel: `${evidence.metricName}: ${formatPct(evidence.pct, { digits: 0 })} of limit`,
					}),
				],
			),
		delta: (evidence) =>
			evidence.series.length >= 2 && evidence.unit !== "minor"
				? h.div(
						[h.Class(twMerge("flex items-center justify-end gap-2", options.className))],
						[
							sparkline(h, {
								values: evidence.series.map((point) => point.value),
								ariaLabel: deltaSummary(evidence),
								tone: evidence.to < evidence.from ? "negative" : "positive",
								endDot: true,
							}),
						],
					)
				: stack(
						h,
						deltaSummary(evidence),
						evidence.changePct === null ? null : formatDeltaPct(evidence.changePct),
						options.className,
					),
		ratio: (evidence) =>
			stack(
				h,
				`${evidence.value} / ${evidence.target} ${evidence.unit === "users" ? "active" : "contacts"}`,
				evidence.daysLeft !== null
					? formatDaysLeft(evidence.daysLeft)
					: evidence.ageDays !== null
						? `${formatDays(evidence.ageDays)} old`
						: null,
				options.className,
			),
	})
}

const fact = <M>(h: HtmlBuilder<M>, label: string, value: Html | string): Html =>
	h.div(
		[h.Class("flex items-baseline justify-between gap-4 text-sm")],
		[
			h.dt([h.Class("text-muted-fg")], [label]),
			h.dd([h.Class("text-right text-fg tabular-nums")], [value]),
		],
	)

/** The side panel's evidence: the numbers as facts, with a chart where the evidence has a series. */
export const evidenceDetail = <M>(
	h: HtmlBuilder<M>,
	evidence: SignalEvidence,
	options: Readonly<{ now: Instant; className?: string }>,
): Html => {
	const date = (at: string | null) => (at === null ? "—" : formatDate(new Date(at), { now: options.now }))
	const facts = (entries: ReadonlyArray<Html>, chart?: Html) =>
		h.div(
			[h.Class(twMerge("flex flex-col gap-3", options.className))],
			[...(chart ? [chart] : []), h.dl([h.Class("flex flex-col gap-1.5")], [...entries])],
		)
	return Match.valueTags(evidence, {
		amount: (evidence) =>
			facts([
				fact(h, "Amount due", formatMoney(evidence.amountMinor, evidence.currency, { cents: true })),
				fact(
					h,
					"Overdue",
					evidence.daysOverdue > 0 ? danger(h, formatDays(evidence.daysOverdue)) : "Not yet",
				),
				...(evidence.invoiceNumber ? [fact(h, "Invoice", evidence.invoiceNumber)] : []),
				...(evidence.attemptCount !== null
					? [fact(h, "Payment attempts", String(evidence.attemptCount))]
					: []),
				...(evidence.declineReason ? [fact(h, "Decline reason", evidence.declineReason)] : []),
				...(evidence.nextRetryAt ? [fact(h, "Next retry", date(evidence.nextRetryAt))] : []),
			]),
		last_active: (evidence) =>
			facts([
				...(evidence.contactName ? [fact(h, "Champion", evidence.contactName)] : []),
				...(evidence.contactEmail ? [fact(h, "Email", evidence.contactEmail)] : []),
				fact(h, "Last active", date(evidence.lastActiveAt)),
				fact(h, "Quiet for", formatDays(evidence.daysInactive)),
				fact(h, "Active users before", formatCount(evidence.priorActiveUsers)),
			]),
		series: (evidence) =>
			facts(
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
				evidenceBars(h, {
					values: evidence.series.map((point) => point.value),
					highlightFrom: evidence.series.length - evidence.recentDays,
					baseline: evidence.baselineAvg,
					ariaLabel: `${evidence.metricKey} by day: ${formatDeltaPct(evidence.changePct)} against the prior ${evidence.baselineDays}-day average`,
					tone: evidence.changePct < 0 ? "negative" : "positive",
				}),
			),
		limit: (evidence) =>
			facts(
				[
					fact(
						h,
						evidence.metricName,
						`${formatCount(evidence.value)} / ${formatCount(evidence.limit)}`,
					),
					fact(h, "Of limit", formatPct(evidence.pct, { digits: 0 })),
				],
				meter(h, {
					value: evidence.value,
					limit: evidence.limit,
					ariaLabel: `${evidence.metricName}: ${formatPct(evidence.pct, { digits: 0 })} of limit`,
					className: "h-1.5 w-full",
				}),
			),
		delta: (evidence) =>
			facts(
				[
					fact(h, "Change", deltaSummary(evidence)),
					...(evidence.changePct === null
						? []
						: [fact(h, "Percent", formatDeltaPct(evidence.changePct))]),
					...(evidence.effectiveAt ? [fact(h, "Takes effect", date(evidence.effectiveAt))] : []),
					...(evidence.reason ? [fact(h, "Reason", evidence.reason)] : []),
				],
				evidence.series.length >= 2
					? sparkline(h, {
							values: evidence.series.map((point) => point.value),
							ariaLabel: deltaSummary(evidence),
							tone: evidence.to < evidence.from ? "negative" : "positive",
							size: "md",
							area: true,
							className: "w-full",
						})
					: undefined,
			),
		ratio: (evidence) =>
			facts([
				fact(
					h,
					evidence.unit === "users" ? "Active users" : "Active contacts",
					`${evidence.value} of ${evidence.target} needed`,
				),
				...(evidence.deadline ? [fact(h, "Trial ends", date(evidence.deadline))] : []),
				...(evidence.daysLeft !== null
					? [fact(h, "Time left", formatDaysLeft(evidence.daysLeft))]
					: []),
				...(evidence.ageDays !== null ? [fact(h, "Account age", formatDays(evidence.ageDays))] : []),
			]),
	})
}
