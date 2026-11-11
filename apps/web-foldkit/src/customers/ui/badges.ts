import type { HealthStatus, LifecycleStage, SignalKind, SignalSeverity } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { badge } from "../../ui/badge"
import { formatDaysLeft } from "../format"
import { IconOpportunity, IconRisk } from "./icons"

/**
 * Status badges and chips (Foundations › Health Badge States, Severity And Kind Chips, Lifecycle
 * Stage Badges). Health is a pill with a dot; stage is square with no dot, so the two never read as
 * the same thing.
 */

// HEALTH

export const HEALTH_LABEL = {
	healthy: "Healthy",
	at_risk: "At risk",
	critical: "Critical",
	unknown: "Unknown",
} as const satisfies Record<HealthStatus, string>

const HEALTH_INTENT = {
	healthy: "success",
	at_risk: "warning",
	critical: "danger",
	unknown: "secondary",
} as const

/** The dot's color: the badge's own foreground, so dot and label always agree. */
const HEALTH_DOT = {
	healthy: "bg-success-subtle-fg",
	at_risk: "bg-warning-subtle-fg",
	critical: "bg-danger-subtle-fg",
	unknown: "bg-muted-fg",
} as const satisfies Record<HealthStatus, string>

/** The chart color of a status (distribution bar, legend squares). */
export const HEALTH_FILL = {
	healthy: "bg-health-healthy",
	at_risk: "bg-health-at-risk",
	critical: "bg-health-critical",
	unknown: "bg-health-unknown",
} as const satisfies Record<HealthStatus, string>

const scoreText = (status: HealthStatus, score: number | null): string =>
	status === "unknown" || score === null ? "—" : String(score)

/** `● Healthy 82`. Without `score` (undefined) the number is left out; `null` shows `—`. */
export const healthBadge = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ status: HealthStatus; score?: number | null; className?: string }>,
): Html =>
	badge(
		h,
		{
			intent: HEALTH_INTENT[options.status],
			className: twMerge(
				"rounded-full px-2",
				options.status === "unknown" && "[--badge-fg:var(--color-muted-fg)]",
				options.className,
			),
		},
		[
			h.span([h.Class(twMerge("size-1.5 shrink-0 rounded-full", HEALTH_DOT[options.status]))]),
			HEALTH_LABEL[options.status],
			...(options.score === undefined
				? []
				: [
						h.span(
							[
								h.Class(
									twMerge(
										"font-semibold",
										options.status === "unknown" ? "text-muted-fg" : "text-fg",
									),
								),
							],
							[scoreText(options.status, options.score)],
						),
					]),
		],
	)

/** `● 82`: dense table cells. The status is in the accessible name, not only the color. */
export const healthDot = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ status: HealthStatus; score: number | null; className?: string }>,
): Html =>
	h.span(
		[
			h.Class(twMerge("inline-flex items-center gap-1.5 text-sm tabular-nums", options.className)),
			h.Title(HEALTH_LABEL[options.status]),
		],
		[
			h.span([h.Class(twMerge("size-2 shrink-0 rounded-full", HEALTH_DOT[options.status]))]),
			h.span([h.Class("sr-only")], [`${HEALTH_LABEL[options.status]} `]),
			h.span(
				[h.Class(options.status === "unknown" ? "text-muted-fg" : "text-fg")],
				[scoreText(options.status, options.score)],
			),
		],
	)

// SEVERITY

export const SEVERITY_LABEL = {
	high: "High",
	medium: "Medium",
	low: "Low",
} as const satisfies Record<SignalSeverity, string>

const SEVERITY_BARS = {
	high: ["bg-severity-high", "bg-severity-high", "bg-severity-high"],
	medium: ["bg-severity-medium", "bg-severity-medium", "bg-severity-off"],
	low: ["bg-severity-low", "bg-severity-off", "bg-severity-off"],
} as const satisfies Record<SignalSeverity, readonly [string, string, string]>

const BAR_HEIGHTS = ["h-1", "h-[7px]", "h-2.5"] as const

/** Three rising bars, lit up to the severity. Alone it carries its name for assistive tech and on hover. */
export const severityGlyph = <M>(
	h: HtmlBuilder<M>,
	severity: SignalSeverity,
	options: Readonly<{ labelled?: boolean }> = {},
): Html =>
	h.span(
		[
			h.Class("flex size-3 shrink-0 items-end gap-[1.5px]"),
			...(options.labelled === false
				? [h.AriaHidden(true)]
				: [
						h.Role("img"),
						h.AriaLabel(`${SEVERITY_LABEL[severity]} severity`),
						h.Title(`${SEVERITY_LABEL[severity]} severity`),
					]),
		],
		SEVERITY_BARS[severity].map((fill, index) =>
			h.span([h.Class(twMerge("block w-[3px] rounded-[1px]", BAR_HEIGHTS[index], fill))]),
		),
	)

/** `▂▄▆ High` in an outlined chip. */
export const severityChip = <M>(
	h: HtmlBuilder<M>,
	severity: SignalSeverity,
	options: Readonly<{ className?: string }> = {},
): Html =>
	badge(h, { intent: "outline", className: twMerge("text-fg", options.className) }, [
		severityGlyph(h, severity, { labelled: false }),
		SEVERITY_LABEL[severity],
	])

// KIND

export const KIND_LABEL = { risk: "Risk", opportunity: "Opportunity" } as const satisfies Record<
	SignalKind,
	string
>

/** `! Risk` (danger) or `↗ Opportunity` (info). */
export const kindChip = <M>(
	h: HtmlBuilder<M>,
	kind: SignalKind,
	options: Readonly<{ className?: string }> = {},
): Html =>
	badge(
		h,
		{ intent: kind === "risk" ? "danger" : "info", className: twMerge("gap-x-1", options.className) },
		[
			kind === "risk"
				? IconRisk(h, { className: "size-3" })
				: IconOpportunity(h, { className: "size-3" }),
			KIND_LABEL[kind],
		],
	)

// LIFECYCLE STAGE

export const STAGE_LABEL = {
	lead: "Lead",
	trialing: "Trialing",
	active: "Active",
	past_due: "Past due",
	churned: "Churned",
} as const satisfies Record<LifecycleStage, string>

const STAGE_INTENT = {
	lead: "secondary",
	trialing: "info",
	active: "success",
	past_due: "warning",
	churned: "outline",
} as const

/** Square, no dot. `trialDaysLeft` adds `· 4 days left` to a trialing badge. */
export const stageBadge = <M>(
	h: HtmlBuilder<M>,
	stage: LifecycleStage,
	options: Readonly<{ trialDaysLeft?: number | null; className?: string }> = {},
): Html =>
	badge(
		h,
		{
			intent: STAGE_INTENT[stage],
			className: twMerge(
				"gap-x-1",
				stage === "churned" && "text-muted-fg",
				stage === "lead" && "[--badge-fg:var(--color-secondary-fg)]",
				options.className,
			),
		},
		[
			STAGE_LABEL[stage],
			...(stage === "trialing" && options.trialDaysLeft != null
				? [
						h.span(
							[h.Class("font-normal opacity-80")],
							[`· ${formatDaysLeft(options.trialDaysLeft)}`],
						),
					]
				: []),
		],
	)

// SIGNAL COUNTS

/** An account's open signals: a severity glyph per non-zero risk count, then opportunities; `—` when none. */
export const signalCounts = <M>(
	h: HtmlBuilder<M>,
	counts: Readonly<{ high: number; medium: number; low: number; opportunities: number }>,
	options: Readonly<{ className?: string }> = {},
): Html => {
	const risks = (["high", "medium", "low"] as const).filter((severity) => counts[severity] > 0)
	const total = counts.high + counts.medium + counts.low + counts.opportunities
	if (total === 0) return h.span([h.Class(twMerge("text-muted-fg text-sm", options.className))], ["—"])
	const label = [
		...risks.map((severity) => `${counts[severity]} ${SEVERITY_LABEL[severity].toLowerCase()} risk`),
		...(counts.opportunities > 0 ? [`${counts.opportunities} opportunity`] : []),
	].join(", ")
	return h.span(
		[
			h.Class(twMerge("inline-flex items-center gap-2.5 text-sm tabular-nums", options.className)),
			h.AriaLabel(label),
			h.Title(label),
		],
		[
			...risks.map((severity) =>
				h.span(
					[h.Class("inline-flex items-center gap-1"), h.AriaHidden(true)],
					[severityGlyph(h, severity, { labelled: false }), String(counts[severity])],
				),
			),
			...(counts.opportunities > 0
				? [
						h.span(
							[
								h.Class("inline-flex items-center gap-1 text-info-subtle-fg"),
								h.AriaHidden(true),
							],
							[IconOpportunity(h, { className: "size-3" }), String(counts.opportunities)],
						),
					]
				: []),
		],
	)
}
