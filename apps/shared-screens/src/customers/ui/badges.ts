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
	// HAZEL-GAP(p4-customers-severity-glyph): today's chip leads with three rising bars lit up to the severity (`severity-*` tokens); `badge` has no glyph, so the label stands alone.
	h.badge.style("outline").label(SEVERITY_LABEL[severity])

// KIND

export const KIND_LABEL = { risk: "Risk", opportunity: "Opportunity" } as const satisfies Record<
	SignalKind,
	string
>

/** `Risk` (danger) or `Opportunity` (info). */
export const kindChip = <Msg>(h: Hazel.H<Msg>, kind: SignalKind) =>
	// HAZEL-GAP(p4-customers-badge-icon): today's kind chip leads with `!` or `↗`; `badge` has an icon part but no `icon` prop.
	h.badge.tone(kind === "risk" ? "danger" : "info").label(KIND_LABEL[kind])

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
	churned: { tone: "neutral", style: "outline" },
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
	// HAZEL-GAP(p4-customers-badge-runs): today's `· 4 days left` is regular weight at 80% opacity and churned's ink is muted; a badge label is one run in its tone's ink.
	h.badge
		.tone(STAGE_LOOK[stage].tone)
		.style(STAGE_LOOK[stage].style)
		.label(stageLabel(stage, options.trialDaysLeft))

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
	// HAZEL-GAP(p4-customers-severity-glyph): today each count leads with its severity bars, and opportunities with `↗` in info ink.
	return h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			...risks.map((severity) =>
				h.text.numeric().children(`${counts[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`),
			),
			counts.opportunities > 0
				? h.text.tone("info").numeric().children(`${counts.opportunities} opp.`)
				: null,
		)
}

// ENVIRONMENT

/** `EU`: an account's environment, beside its name. */
export const environmentBadge = <Msg>(h: Hazel.H<Msg>, environment: string) =>
	// HAZEL-GAP(p4-customers-badge-truncate): today a long environment truncates at `max-w-32` with its name on hover; a badge never truncates.
	h.badge.label(environment)

/** `+2 environments` beside a primary's name, muted; nothing for an account without environments. */
export const environmentsHint = <Msg>(h: Hazel.H<Msg>, count: number) => {
	const hint = environmentsHintOf(count)
	return hint === null ? null : h.text.role("caption").tone("muted").children(hint)
}
