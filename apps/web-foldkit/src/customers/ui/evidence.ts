import { overdueLabel, type SignalEvidence } from "@hazel/domain/customers"
import { Match } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { meter, sparkline } from "../charts/sparkline"
import {
	formatCompact,
	formatCount,
	formatDays,
	formatDaysLeft,
	formatDeltaPct,
	formatMoney,
	formatPct,
} from "../format"

/**
 * A signal's evidence, drawn by its `_tag` (the `viz`): the queue row's mini-viz (`evidenceViz`)
 * (the side panel's fuller version is native: `@hazel/shared-screens/customers/ui/evidence`).
 */

type Of<Tag extends SignalEvidence["_tag"]> = Extract<SignalEvidence, { _tag: Tag }>

const deltaValue = (evidence: Of<"delta">, value: number): string =>
	evidence.unit === "minor" ? formatMoney(value, evidence.currency ?? "USD") : formatCount(value)

/** `$1,240 → $0`, `8 → 20 users`, or the labels (`Scale → Growth`) when set. */
export const deltaSummary = (evidence: Of<"delta">): string =>
	evidence.fromLabel !== null && evidence.toLabel !== null
		? `${evidence.fromLabel} → ${evidence.toLabel}`
		: `${deltaValue(evidence, evidence.from)} → ${deltaValue(evidence, evidence.to)}${evidence.unit === "minor" ? "" : " users"}`

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
		overdue: (evidence) =>
			stack(
				h,
				danger(h, `${overdueLabel(evidence.overdueMs)} overdue`),
				evidence.count === 1 ? "1 issue" : `${formatCount(evidence.count)} issues`,
				options.className,
			),
	})
}
