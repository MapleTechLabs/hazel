import type { Html, HtmlBuilder } from "foldkit/html"
import {
	calendarHeatmap,
	heatLegend,
} from "../../../../apps/web-foldkit/src/customers/charts/calendar-heatmap.ts"
import { distributionBar } from "../../../../apps/web-foldkit/src/customers/charts/distribution.ts"
import { evidenceBars, sparkline } from "../../../../apps/web-foldkit/src/customers/charts/sparkline.ts"
import { kpiTile } from "../../../../apps/web-foldkit/src/customers/ui/kpi-tile.ts"
import heatmap from "../conformance/fixtures/heatmap/default.json"
import evidence from "../conformance/fixtures/chart/evidence.json"

/**
 * The kit side of lane W2b's specimens: today's sparklines, evidence bars, 100% bar, activity
 * calendar and KPI tile (`customers/charts`, `customers/ui/kpi-tile.ts`), with their fixtures' content.
 */

type H = HtmlBuilder<never>

/** The gallery dispatches nothing; the calendar builds its hover messages up front. */
const noMessage = (): never => undefined as never

const specimen = (h: H, id: string, child: Html): Html =>
	h.div(
		[h.Class("frame-button")],
		[h.div([h.Class("inline-flex"), h.Attribute("data-specimen", id)], [child])],
	)

/**
 * As wide as the fixture gallery's `screen` frame: a block, not a `.frames` flex line, which the
 * calendar's phone width (`min-w-160`) would widen.
 */
const wide = (h: H, id: string, children: ReadonlyArray<Html>, className = ""): Html =>
	h.div(
		[h.Attribute("style", "max-width: 720px; margin-bottom: 24px;")],
		[h.div([h.Class(className), h.Attribute("data-specimen", id)], [...children])],
	)

const seats = [4, 6, 5, 8, 7, 9, 8, 11]
const usage = evidence.root.props.series[0]?.values ?? []
const highlightFrom = evidence.root.props.highlightFrom
const prior = usage.slice(0, highlightFrom)

const days = heatmap.root.props.days
const selected = days.findIndex((day) => day.date === heatmap.root.props.selected)

export const chartSpecimens = (h: H): Html =>
	h.div(
		[],
		[
			h.div(
				[h.Class("frames")],
				[
					specimen(
						h,
						"chart-sparkline",
						sparkline(h, { values: seats, ariaLabel: "Seats", tone: "positive", endDot: true }),
					),
					specimen(
						h,
						"chart-sparkline-card",
						sparkline(h, {
							values: [40, 42, 41, 45, 44, 47, 46, 48],
							ariaLabel: "MRR",
							tone: "positive",
							size: "md",
							area: true,
						}),
					),
					specimen(
						h,
						"stat-tile",
						kpiTile(h, {
							id: "kit-stat-tile",
							label: "MRR",
							definition:
								"Monthly recurring revenue: the sum of every active subscription, normalised to a month.",
							value: "$48.2k",
							delta: { value: 4.1, text: "4.1%" },
							comparison: "vs previous 30 days",
						}),
					),
				],
			),
			h.div(
				[],
				[
					wide(h, "chart-evidence", [
						evidenceBars(h, {
							values: usage,
							highlightFrom,
							baseline: prior.reduce((sum, value) => sum + value, 0) / prior.length,
							ariaLabel: "API calls by day",
							tone: "negative",
						}),
					]),
					wide(h, "chart-distribution", [
						distributionBar(h, {
							ariaLabel: "Users by activity",
							segments: [
								{ key: "active", label: "Active", value: 18, fillClass: "bg-chart-new" },
								{
									key: "dormant",
									label: "Dormant",
									value: 7,
									fillClass: "bg-chart-contraction",
								},
								{
									key: "never",
									label: "Never active",
									value: 3,
									fillClass: "bg-chart-neutral",
								},
							],
						}),
					]),
					// The Activity tab's calendar over its legend (`detail/activity-tab.ts`), each level as its value.
					wide(
						h,
						"heatmap",
						[
							calendarHeatmap(h, {
								points: days.map((day) => ({ day: day.date, value: day.level })),
								ariaLabel: heatmap.root.props.label,
								describe: () => days[selected]?.label ?? "",
								hoveredIndex: selected,
								onHover: noMessage,
								idPrefix: "kit-day",
							}),
							h.div([h.Class("flex justify-end")], [heatLegend(h)]),
						],
						"flex flex-col gap-4",
					),
				],
			),
		],
	)
