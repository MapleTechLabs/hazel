// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Status badges and chips (today's `web-foldkit/src/customers/ui/badges.ts`): severity, signal kind,
 * lifecycle stage, an account's environment and its open signal counts, on the hazel `badge`.
 */
import type { LifecycleStage, SignalKind, SignalSeverity } from "@hazel/domain/customers"
import type { BadgeStyle, BadgeTone, Hazel } from "@hazel/ui/vocabulary/index"
import { formatDaysLeft } from "../data/format"
import { environmentsHintOf } from "../data/groups"

// SEVERITY

export const SEVERITY_LABEL = {
	high: "High",
	medium: "Medium",
	low: "Low",
} as const satisfies Record<SignalSeverity, string>

/** `High` in an outlined chip. */
export const severityChip = <Msg>(h: Hazel.H<Msg>, severity: SignalSeverity) =>
	h.badge.style("outline").severity(severity).label(SEVERITY_LABEL[severity])

// KIND

export const KIND_LABEL = { risk: "Risk", opportunity: "Opportunity" } as const satisfies Record<
	SignalKind,
	string
>

/** `Risk` (danger) or `Opportunity` (info). */
export const kindChip = <Msg>(h: Hazel.H<Msg>, kind: SignalKind) =>
	h.badge
		.tone(kind === "risk" ? "danger" : "info")
		.icon(kind)
		.label(KIND_LABEL[kind])

// LIFECYCLE STAGE

export const STAGE_LABEL = {
	lead: "Lead",
	trialing: "Trialing",
	active: "Active",
	past_due: "Past due",
	churned: "Churned",
} as const satisfies Record<LifecycleStage, string>

/** Today's intents as tone and style (the badge recipe's own mapping). */
const STAGE_LOOK = {
	lead: { tone: "neutral", style: "solid" },
	trialing: { tone: "info", style: "solid" },
	active: { tone: "success", style: "solid" },
	past_due: { tone: "warning", style: "solid" },
	churned: { tone: "neutral", style: "quietOutline" },
} as const satisfies Record<LifecycleStage, { tone: BadgeTone; style: BadgeStyle }>

/** The stage's label; `trialDaysLeft` adds `· 4 days left` to a trialing badge. */
export const stageLabel = (stage: LifecycleStage, trialDaysLeft?: number | null): string =>
	stage === "trialing" && trialDaysLeft != null
		? `${STAGE_LABEL[stage]} · ${formatDaysLeft(trialDaysLeft)}`
		: STAGE_LABEL[stage]

/** Square, no dot. */
export const stageBadge = <Msg>(
	h: Hazel.H<Msg>,
	stage: LifecycleStage,
	options: Readonly<{ trialDaysLeft?: number | null }> = {},
) =>
	h.badge
		.tone(STAGE_LOOK[stage].tone)
		.style(STAGE_LOOK[stage].style)
		.label(STAGE_LABEL[stage])
		.detail(
			stage === "trialing" && options.trialDaysLeft != null
				? `· ${formatDaysLeft(options.trialDaysLeft)}`
				: undefined,
		)

// SIGNAL COUNTS

/** Today's mark for a cell with nothing in it (U+2014). */
export const NO_VALUE = "\u2014"

export type SignalCounts = Readonly<{ high: number; medium: number; low: number; opportunities: number }>

/** `2 high risk, 1 opportunity`: what the counts say, for the cell's label and tests. */
export const signalCountsLabel = (counts: SignalCounts): string =>
	[
		...(["high", "medium", "low"] as const)
			.filter((severity) => counts[severity] > 0)
			.map((severity) => `${counts[severity]} ${SEVERITY_LABEL[severity].toLowerCase()} risk`),
		...(counts.opportunities > 0 ? [`${counts.opportunities} opportunity`] : []),
	].join(", ")

/** An account's open signals: a count per non-zero severity, then opportunities; `-` when none. */
export const signalCounts = <Msg>(h: Hazel.H<Msg>, counts: SignalCounts) => {
	const risks = (["high", "medium", "low"] as const).filter((severity) => counts[severity] > 0)
	if (risks.length === 0 && counts.opportunities === 0) return h.text.tone("muted").children(NO_VALUE)
	return h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			...risks.map((severity) =>
				h.badge.style("plain").severity(severity).label(String(counts[severity])),
			),
			counts.opportunities > 0
				? h.badge.style("plain").tone("info").icon("opportunity").label(String(counts.opportunities))
				: null,
		)
}

// ENVIRONMENT

/** `EU`: an account's environment, beside its name. */
export const environmentBadge = <Msg>(h: Hazel.H<Msg>, environment: string) =>
	h.badge.truncate().label(environment)

/** `+2 environments` beside a primary's name, muted; nothing for an account without environments. */
export const environmentsHint = <Msg>(h: Hazel.H<Msg>, count: number) => {
	const hint = environmentsHintOf(count)
	return hint === null ? null : h.text.role("caption").tone("muted").children(hint)
}
