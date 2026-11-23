import type {
	HealthBands,
	HealthBreakdown,
	HealthComponentKey,
	HealthComponentResult,
} from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { activityProviders, billingProviders } from "@hazel/customer-integrations"
import { cardClassName } from "../../ui/card"
import { dataTable } from "../../ui/data-table"
import { heading } from "../../ui/heading"
import { sourceLabel, usageSources } from "../providers"
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
	usage: usageSources.map(sourceLabel).join(" · "),
	engagement: activityProviders.map(sourceLabel).join(" · "),
	billing: billingProviders.map(sourceLabel).join(" · "),
	signals: sourceLabel("hazel"),
} satisfies Record<HealthComponentKey, string>

const bandFill = (score: number, bands: HealthBands) =>
	score >= bands.healthyMin
		? "bg-health-healthy"
		: score >= bands.atRiskMin
			? "bg-health-at-risk"
			: "bg-health-critical"

const pointsOf = (component: HealthComponentResult) =>
	component.score === null ? 0 : (component.score * component.effectiveWeight) / 100

const formatWeight = (weight: number) => `${Math.round(weight)}%`

/** A score on a track, filled in its band's colour. */
const meter = <M>(
	h: HtmlBuilder<M>,
	score: number,
	bands: HealthBands,
	trackClass: string,
	fillClass?: string,
): Html =>
	h.span(
		[h.Class(twMerge("block overflow-hidden rounded-full bg-secondary", trackClass))],
		[
			h.span([
				h.Class(twMerge("block h-full", fillClass, bandFill(score, bands))),
				h.Style({ width: `${score}%` }),
			]),
		],
	)

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
		/** Inside a disclosure that already names the score: no title row, border or radius. */
		isBare?: boolean
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
				options.isBare === true
					? twMerge("flex min-w-0 flex-col", options.className)
					: cardClassName(twMerge("flex min-w-0 flex-col", options.className)),
			),
		],
		[
			h.header(
				[h.Class("flex flex-col gap-3 p-4 sm:p-5")],
				[
					...(options.isBare === true
						? []
						: [
								h.div(
									[h.Class("flex flex-wrap items-start justify-between gap-x-4 gap-y-1")],
									[
										h.div(
											[h.Class("flex min-w-0 flex-1 basis-48 flex-col gap-1")],
											[
												heading(
													h,
													{
														variant: "section",
														className:
															"flex flex-wrap items-center gap-x-2 gap-y-1",
													},
													[
														score === null
															? "No health score yet"
															: `Why health is ${score}`,
														healthBadge(h, { status: breakdown.status }),
													],
												),
												...(options.subtitle
													? [
															h.p(
																[h.Class("text-muted-fg text-sm")],
																[options.subtitle],
															),
														]
													: []),
											],
										),
										...(options.action ? [options.action] : []),
									],
								),
							]),
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
									meter(h, component.score ?? 0, bands, "h-1.5", "rounded-full"),
									h.span(
										// A phone has no room for these under the bars; the table below says the same.
										[
											h.Class(
												"truncate text-muted-fg text-xs tabular-nums max-sm:hidden",
											),
										],
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
			dataTable(h, {
				ariaLabel: "Health components",
				id: "health-breakdown",
				isFramed: false,
				className: "border-border border-t",
				rows: ordered,
				rowKey: (component) => component.key,
				columns: [
					{
						key: "component",
						label: "Component",
						widthClass: "w-32 max-sm:w-28",
						cell: (component) =>
							h.div(
								[h.Class("py-3")],
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
										[component.excluded ? "No data" : COMPONENT_SOURCES[component.key]],
									),
								],
							),
					},
					{
						key: "why",
						label: "Why",
						cell: (component) => {
							const action = component.excluded
								? (options.excludedAction?.(component.key) ?? null)
								: null
							return h.div(
								[h.Class("py-3")],
								[
									h.p(
										[h.Class(component.excluded ? "text-muted-fg" : "text-fg-2")],
										[component.why],
									),
									...(action === null ? [] : [h.div([h.Class("mt-1")], [action])]),
								],
							)
						},
					},
					{
						key: "score",
						label: "Score",
						align: "right",
						widthClass: "w-32",
						// A phone keeps the points (they sum to the score) and drops the score and weight.
						hideClass: "max-sm:hidden",
						cell: (component) =>
							component.score === null
								? h.span(
										[
											h.Class(
												"rounded-sm border border-border border-dashed px-1.5 py-0.5 text-muted-fg text-xs",
											),
										],
										["Excluded"],
									)
								: h.span(
										[h.Class("inline-flex items-center justify-end gap-3")],
										[
											meter(h, component.score, bands, "h-1 w-10"),
											h.span(
												[h.Class("w-8 font-medium text-fg tabular-nums")],
												[String(component.score)],
											),
										],
									),
					},
					{
						key: "weight",
						label: "Weight",
						align: "right",
						widthClass: "w-24",
						hideClass: "max-sm:hidden",
						cell: (component) =>
							h.span(
								[],
								[
									...(isRedistributed &&
									Math.round(component.effectiveWeight) !== component.weight
										? [
												h.span(
													[h.Class("mr-1.5 text-muted-fg text-xs line-through")],
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
					},
					{
						key: "points",
						label: "Points",
						align: "right",
						widthClass: "w-20",
						cell: (component) =>
							h.span(
								[h.Class(component.excluded ? "font-medium text-muted-fg" : "font-medium")],
								[component.excluded ? "—" : pointsOf(component).toFixed(1)],
							),
					},
				],
			}),
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
