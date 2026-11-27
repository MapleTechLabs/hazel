import type { LifecycleStage, SignalKind, SignalSeverity } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { badge } from "../../ui/badge"
import { formatDaysLeft } from "../format"
import { environmentsHintOf } from "../groups"
import { IconOpportunity, IconRisk } from "./icons"

/**
 * Status badges and chips (Foundations › Severity And Kind Chips, Lifecycle Stage Badges).
 */

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
			h.span([h.Class(twMerge("block w-[3px] rounded-xs", BAR_HEIGHTS[index], fill))]),
		),
	)

/** `▂▄▆ High` in an outlined chip. */
export const severityChip = <M>(
	h: HtmlBuilder<M>,
	severity: SignalSeverity,
	options: Readonly<{ className?: string }> = {},
): Html =>
	badge(
		h,
		{ intent: "outline", className: twMerge("shrink-0 whitespace-nowrap text-fg", options.className) },
		[severityGlyph(h, severity, { labelled: false }), SEVERITY_LABEL[severity]],
	)

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
		{
			intent: kind === "risk" ? "danger" : "info",
			className: twMerge("shrink-0 gap-x-1 whitespace-nowrap", options.className),
		},
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
				"shrink-0 gap-x-1 whitespace-nowrap",
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

// ENVIRONMENT

/** `EU`: an account's environment, beside its name; a long name truncates. */
export const environmentBadge = <M>(
	h: HtmlBuilder<M>,
	environment: string,
	options: Readonly<{ className?: string }> = {},
): Html =>
	badge(h, { intent: "secondary", className: twMerge("min-w-0 max-w-32 shrink-0", options.className) }, [
		h.span([h.Class("min-w-0 truncate"), h.Title(environment)], [environment]),
	])
