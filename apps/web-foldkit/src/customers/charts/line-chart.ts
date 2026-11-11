import type { ActiveUsersPoint } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { bucketLabels, formatCompact, formatCount } from "../format"
import {
	CHART_COLOR,
	type ChartColor,
	chartTooltip,
	type LegendItem,
	gridlines,
	hoverBands,
	percentSvg,
	plotDot,
	strokePath,
	xAxis,
	yAxis,
} from "./frame"
import { linePath, niceTicks, pointX, scaleLinear, spreadLabels, tickIndexes } from "./scale"

/**
 * Multi-series line chart (Foundations › Line Chart Active Users): gridlines, y ticks, x ticks,
 * end labels and a hover crosshair with every series' value at that index.
 */

export type LineSeries = Readonly<{
	key: string
	label: string
	color: ChartColor
	/** One value per x index; every series has the same length as `xLabels`. */
	values: ReadonlyArray<number>
}>

export type LineChartOptions<M> = Readonly<{
	/** What the chart shows, for assistive tech ("Active users, last 30 days: DAU 444, …"). */
	ariaLabel: string
	series: ReadonlyArray<LineSeries>
	/** The x tick label per index (`Oct 12`). */
	xLabels: ReadonlyArray<string>
	/** The tooltip heading per index (`Mon, Oct 12`). */
	headings: ReadonlyArray<string>
	formatValue: (value: number) => string
	formatAxis?: (value: number) => string
	hoveredIndex: number | null
	onHover: (index: number | null) => M
	/** `MAU 1,611` right of each line's end. */
	endLabels?: boolean
	maxXTicks?: number
	/** The plot's height (default `h-52`). */
	heightClass?: string
	className?: string
}>

export const lineChart = <M>(h: HtmlBuilder<M>, options: LineChartOptions<M>): Html => {
	const count = options.xLabels.length
	const all = options.series.flatMap((series) => series.values)
	const domain = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4)
	const y = scaleLinear([domain.min, domain.max], [100, 0])
	const formatAxis = options.formatAxis ?? options.formatValue
	const xAt = (index: number) => pointX(index, count)
	const xs = Array.from({ length: count }, (_, index) => xAt(index))
	const hovered =
		options.hoveredIndex !== null && options.hoveredIndex < count ? options.hoveredIndex : null
	const lastYs = options.series.map((series) => y(series.values[series.values.length - 1] ?? 0))
	const endYs = spreadLabels(lastYs, 9)

	return h.div(
		[
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge("flex min-w-0 flex-col", options.className)),
		],
		[
			h.div(
				[h.Class(twMerge("flex", options.heightClass ?? "h-52"))],
				[
					yAxis(
						h,
						domain.ticks.map((tick) => ({ y: y(tick), label: formatAxis(tick) })),
					),
					h.div(
						[h.Class("relative min-w-0 flex-1"), h.OnMouseLeave(options.onHover(null))],
						[
							gridlines(
								h,
								domain.ticks.map((tick) => ({ y: y(tick), isZero: tick === 0 })),
							),
							percentSvg(
								h,
								options.series.map((series) =>
									strokePath(
										h,
										linePath(
											series.values.map(
												(value, index) => [xAt(index), y(value)] as const,
											),
										),
										CHART_COLOR[series.color].stroke,
									),
								),
							),
							...(hovered === null
								? []
								: [
										h.span([
											h.AriaHidden(true),
											h.Class(
												"pointer-events-none absolute inset-y-0 border-fg-2/60 border-l",
											),
											h.Style({ left: `${xAt(hovered)}%` }),
										]),
										...options.series.map((series) =>
											plotDot(
												h,
												xAt(hovered),
												y(series.values[hovered] ?? 0),
												CHART_COLOR[series.color].bg,
											),
										),
										chartTooltip(h, {
											x: xAt(hovered),
											heading: options.headings[hovered] ?? "",
											rows: options.series.map((series) => ({
												label: series.label,
												value: options.formatValue(series.values[hovered] ?? 0),
												color: series.color,
												mark: "dot" as const,
											})),
										}),
									]),
							...hoverBands(h, xs, count <= 1 ? 100 : 100 / (count - 1), options.onHover),
						],
					),
					...(options.endLabels
						? [
								h.div(
									[h.AriaHidden(true), h.Class("relative w-24 shrink-0")],
									options.series.map((series, index) =>
										h.span(
											[
												h.Class(
													"absolute left-2 -translate-y-1/2 whitespace-nowrap text-muted-fg text-xs tabular-nums",
												),
												h.Style({ top: `${endYs[index]}%` }),
											],
											[
												`${series.label} `,
												h.span(
													[h.Class("text-fg")],
													[
														options.formatValue(
															series.values[series.values.length - 1] ?? 0,
														),
													],
												),
											],
										),
									),
								),
							]
						: []),
				],
			),
			h.div(
				[h.Class("flex")],
				[
					h.div([h.Class("w-12 shrink-0")]),
					h.div(
						[h.Class("min-w-0 flex-1")],
						[
							xAxis(
								h,
								tickIndexes(count, options.maxXTicks ?? 5).map((index) => ({
									x: xAt(index),
									label: options.xLabels[index] ?? "",
									isActive: index === hovered,
								})),
							),
						],
					),
					...(options.endLabels ? [h.div([h.Class("w-24 shrink-0")])] : []),
				],
			),
		],
	)
}

// ACTIVE USERS

export const ACTIVE_USERS_LEGEND: ReadonlyArray<LegendItem> = [
	{ label: "MAU", color: "series-3", mark: "line" },
	{ label: "WAU", color: "series-2", mark: "line" },
	{ label: "DAU", color: "series-1", mark: "line" },
]

/** DAU / WAU / MAU over `customers.overview`'s `activeUsers`. */
export const activeUsersChart = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		points: ReadonlyArray<ActiveUsersPoint>
		bucket: "day" | "week" | "month"
		hoveredIndex: number | null
		onHover: (index: number | null) => M
		className?: string
	}>,
): Html => {
	const labels = options.points.map((point) => bucketLabels(options.bucket, point.day))
	const last = options.points[options.points.length - 1]
	return lineChart(h, {
		ariaLabel:
			last === undefined
				? "Active users: no data"
				: `Active users: MAU ${formatCount(last.mau)}, WAU ${formatCount(last.wau)}, DAU ${formatCount(last.dau)}`,
		series: [
			{ key: "mau", label: "MAU", color: "series-3", values: options.points.map((point) => point.mau) },
			{ key: "wau", label: "WAU", color: "series-2", values: options.points.map((point) => point.wau) },
			{ key: "dau", label: "DAU", color: "series-1", values: options.points.map((point) => point.dau) },
		],
		xLabels: labels.map((label) => label.tick),
		headings: labels.map((label) => label.heading),
		formatValue: formatCount,
		formatAxis: formatCompact,
		hoveredIndex: options.hoveredIndex,
		onHover: options.onHover,
		endLabels: true,
		className: options.className,
	})
}
