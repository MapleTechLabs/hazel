import type {
	HealthBands,
	HealthBreakdown,
	HealthComponentKey,
	HealthComponentResult,
} from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { healthBadge } from "./badges"

/**
 * "Why health is N" (Customer Page › overview, Health Breakdown Excluded Component): a points bar
 * (each component's width is its effective weight, filled by its score), then one row per component
 * with why, score, weight and points. An excluded component shows its configured weight struck
 * through and 0%; the others show what they gained from it.
 */

export const COMPONENT_LABEL = {
	usage: "Usage",
	engagement: "Engagement",
	billing: "Billing",
	signals: "Signals",
} as const satisfies Record<HealthComponentKey, string>

/** Where a component's inputs come from. */
export const COMPONENT_SOURCES = {
	usage: "Maple · Clerk",
	engagement: "Clerk · Maple",
	billing: "Stripe · Autumn",
	signals: "Hazel",
} as const satisfies Record<HealthComponentKey, string>

const bandFill = (score: number, bands: HealthBands) =>
	score >= bands.healthyMin
		? "bg-health-healthy"
		: score >= bands.atRiskMin
			? "bg-health-at-risk"
			: "bg-health-critical"

const pointsOf = (component: HealthComponentResult) =>
	component.score === null ? 0 : (component.score * component.effectiveWeight) / 100

const formatWeight = (weight: number) => `${Math.round(weight)}%`

export const healthBreakdown = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		breakdown: HealthBreakdown
		bands: HealthBands
		/** Under the title: `Down 17 points from 71 on Oct 27.` */
		subtitle?: string
		/** Top right: `Edit weights` (a link or button). */
		action?: Html
		/** Under an excluded component's why: `Link a billing record`. */
		excludedAction?: (key: HealthComponentKey) => Html | null
		className?: string
	}>,
): Html => {
	const { breakdown, bands } = options
	const included = breakdown.components.filter((component) => !component.excluded)
	const ordered = [...included, ...breakdown.components.filter((component) => component.excluded)]
	const isRedistributed = breakdown.components.some((component) => component.excluded)
	const score = breakdown.score
	return h.section(
		[
			h.Class(
				twMerge(
					"flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg",
					options.className,
				),
			),
		],
		[
			h.header(
				[h.Class("flex flex-col gap-3 p-4 sm:p-5")],
				[
					h.div(
						[h.Class("flex items-start justify-between gap-4")],
						[
							h.div(
								[h.Class("flex min-w-0 flex-col gap-1")],
								[
									h.h2(
										[h.Class("flex items-center gap-2 font-semibold text-base text-fg")],
										[
											score === null ? "No health score yet" : `Why health is ${score}`,
											healthBadge(h, { status: breakdown.status }),
										],
									),
									...(options.subtitle
										? [h.p([h.Class("text-muted-fg text-sm")], [options.subtitle])]
										: []),
								],
							),
							...(options.action ? [options.action] : []),
						],
					),
					h.div(
						[
							h.Role("img"),
							h.AriaLabel(
								included
									.map(
										(component) =>
											`${COMPONENT_LABEL[component.key]} ${pointsOf(component).toFixed(1)} of ${formatWeight(component.effectiveWeight)}`,
									)
									.join(", "),
							),
							h.Class("flex w-full gap-1"),
						],
						included.map((component) =>
							h.div(
								[
									h.Class("flex min-w-0 flex-col gap-1.5"),
									h.Style({ width: `${component.effectiveWeight}%` }),
								],
								[
									h.span(
										[h.Class("block h-1.5 overflow-hidden rounded-full bg-secondary")],
										[
											h.span([
												h.Class(
													twMerge(
														"block h-full rounded-full",
														bandFill(component.score ?? 0, bands),
													),
												),
												h.Style({ width: `${component.score ?? 0}%` }),
											]),
										],
									),
									h.span(
										[h.Class("truncate text-muted-fg text-xs tabular-nums")],
										[
											`${COMPONENT_LABEL[component.key]} ${Math.round(pointsOf(component))} of ${Math.round(component.effectiveWeight)}`,
										],
									),
								],
							),
						),
					),
				],
			),
			h.table(
				[h.Class("w-full border-separate border-spacing-0 text-sm")],
				[
					h.thead(
						[],
						[
							h.tr(
								[
									h.Class(
										"[&>th]:h-9 [&>th]:border-border [&>th]:border-y [&>th]:font-normal [&>th]:text-muted-fg",
									),
								],
								[
									h.th(
										[h.Scope("col"), h.Class("w-32 pl-4 text-left sm:pl-5")],
										["Component"],
									),
									h.th([h.Scope("col"), h.Class("px-3 text-left")], ["Why"]),
									h.th([h.Scope("col"), h.Class("w-32 px-3 text-right")], ["Score"]),
									h.th([h.Scope("col"), h.Class("w-24 px-3 text-right")], ["Weight"]),
									h.th(
										[h.Scope("col"), h.Class("w-20 pr-4 text-right sm:pr-5")],
										["Points"],
									),
								],
							),
						],
					),
					h.tbody(
						[
							h.Class(
								"[&>tr+tr>td]:border-border [&>tr+tr>td]:border-t [&_td]:py-3 [&_td]:align-top",
							),
						],
						ordered.map((component) => {
							const action = component.excluded
								? (options.excludedAction?.(component.key) ?? null)
								: null
							return h.tr(
								[
									h.Key(component.key),
									...(component.excluded ? [h.Class("text-muted-fg")] : []),
								],
								[
									h.td(
										[h.Class("pl-4 sm:pl-5")],
										[
											h.div(
												[
													h.Class(
														twMerge(
															"font-medium",
															component.excluded ? "text-muted-fg" : "text-fg",
														),
													),
												],
												[COMPONENT_LABEL[component.key]],
											),
											h.div(
												[h.Class("text-muted-fg text-xs")],
												[
													component.excluded
														? "No data"
														: COMPONENT_SOURCES[component.key],
												],
											),
										],
									),
									h.td(
										[h.Class("px-3")],
										[
											h.p(
												[h.Class(component.excluded ? "text-muted-fg" : "text-fg-2")],
												[component.why],
											),
											...(action === null ? [] : [h.div([h.Class("mt-1")], [action])]),
										],
									),
									h.td(
										[h.Class("px-3 text-right")],
										[
											component.score === null
												? h.span(
														[
															h.Class(
																"rounded border border-border border-dashed px-1.5 py-0.5 text-xs",
															),
														],
														["Excluded"],
													)
												: h.span(
														[
															h.Class(
																"inline-flex items-center justify-end gap-3",
															),
														],
														[
															h.span(
																[
																	h.Class(
																		"block h-1 w-10 overflow-hidden rounded-full bg-secondary",
																	),
																],
																[
																	h.span([
																		h.Class(
																			twMerge(
																				"block h-full",
																				bandFill(
																					component.score,
																					bands,
																				),
																			),
																		),
																		h.Style({
																			width: `${component.score}%`,
																		}),
																	]),
																],
															),
															h.span(
																[
																	h.Class(
																		"w-8 font-medium text-fg tabular-nums",
																	),
																],
																[String(component.score)],
															),
														],
													),
										],
									),
									h.td(
										[h.Class("px-3 text-right tabular-nums")],
										[
											...(isRedistributed &&
											Math.round(component.effectiveWeight) !== component.weight
												? [
														h.span(
															[
																h.Class(
																	"mr-1.5 text-muted-fg text-xs line-through",
																),
															],
															[formatWeight(component.weight)],
														),
													]
												: []),
											h.span(
												[h.Class(component.excluded ? "text-muted-fg" : "text-fg-2")],
												[formatWeight(component.effectiveWeight)],
											),
										],
									),
									h.td(
										[h.Class("pr-4 text-right font-medium tabular-nums sm:pr-5")],
										[component.excluded ? "—" : pointsOf(component).toFixed(1)],
									),
								],
							)
						}),
					),
				],
			),
			h.footer(
				[
					h.Class(
						"flex items-center justify-between gap-4 border-border border-t bg-wash px-4 py-3 sm:px-5",
					),
				],
				[
					h.p(
						[h.Class("text-muted-fg text-xs")],
						[
							isRedistributed
								? `${included.length} of ${breakdown.components.length} components have data. Weights shown after redistribution; struck-through values are your settings.`
								: `All ${breakdown.components.length} components have data. A component without data is left out and its weight is shared across the rest.`,
						],
					),
					h.span(
						[h.Class("shrink-0 font-semibold text-fg tabular-nums")],
						[score === null ? "—" : `${score} / 100`],
					),
				],
			),
		],
	)
}
