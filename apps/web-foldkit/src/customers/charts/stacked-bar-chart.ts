import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	CHART_COLOR,
	type ChartColor,
	chartTooltip,
	gridlines,
	hoverBands,
	type LegendItem,
	percentSvg,
	plotDot,
	strokePath,
	xAxis,
	yAxis,
} from "./frame"
import {
	bandWidth,
	bandX,
	linePath,
	niceTicks,
	scaleLinear,
	stackExtent,
	stackSegments,
	tickIndexes,
} from "./scale"

/**
 * Stacked bars around zero with an optional net line (Foundations › Stacked Bar Chart MRR
 * Movement): gains stack up, losses stack down, the net of each bucket is a dot on a line.
 */

export type Stack = Readonly<{ key: string; label: string; color: ChartColor }>

export type StackedBar = Readonly<{
	tick: string
	heading: string
	/** By stack key; negative values stack below zero. */
	values: Readonly<Record<string, number>>
	net: number
}>

export type StackedBarChartOptions<M> = Readonly<{
	ariaLabel: string
	/** Stack order, bottom-up from zero (gains, then losses downward). */
	stacks: ReadonlyArray<Stack>
	bars: ReadonlyArray<StackedBar>
	/** Draw the net line, with this label in the tooltip. */
	netLabel?: string
	formatValue: (value: number) => string
	formatAxis?: (value: number) => string
	/** Whole-number y ticks, for counts. */
	integerTicks?: boolean
	hoveredIndex: number | null
	onHover: (index: number | null) => M
	maxXTicks?: number
	heightClass?: string
	className?: string
}>

export const stackedBarChart = <M>(h: HtmlBuilder<M>, options: StackedBarChartOptions<M>): Html => {
	const count = options.bars.length
	const values = options.bars.map((bar) => options.stacks.map((stack) => bar.values[stack.key] ?? 0))
	const [lo, hi] = stackExtent(values, options.netLabel ? options.bars.map((bar) => bar.net) : [])
	const domain = niceTicks(lo, hi, 5, { integer: options.integerTicks })
	const y = scaleLinear([domain.min, domain.max], [100, 0])
	const formatAxis = options.formatAxis ?? options.formatValue
	const xAt = (index: number) => bandX(index, count)
	const xs = options.bars.map((_, index) => xAt(index))
	const band = bandWidth(count)
	const barWidth = Math.min(band * 0.55, 8)
	const hovered =
		options.hoveredIndex !== null && options.hoveredIndex < count ? options.hoveredIndex : null
	const hoveredBar = hovered === null ? undefined : options.bars[hovered]
	const ticks = new Set(tickIndexes(count, options.maxXTicks ?? 12))
	const colorOf = new Map(options.stacks.map((stack) => [stack.key, stack.color]))

	const bar = (entry: StackedBar, index: number): Html => {
		const segments = stackSegments(
			options.stacks.map((stack) => ({ key: stack.key, value: entry.values[stack.key] ?? 0 })),
		)
		const lastUp = segments.findLast((segment) => segment.to > 0)
		const lastDown = segments.findLast((segment) => segment.to < 0)
		return h.div(
			[
				h.AriaHidden(true),
				h.Class("pointer-events-none absolute inset-y-0"),
				h.Style({ left: `${xAt(index) - barWidth / 2}%`, width: `${barWidth}%` }),
			],
			segments.map((segment) => {
				const top = Math.min(y(segment.from), y(segment.to))
				// Insets, not a height: a percentage height needs the parent's height, which the native
				// renderer does not resolve.
				const bottom = 100 - Math.max(y(segment.from), y(segment.to))
				return h.span([
					h.Class(
						twMerge(
							"absolute inset-x-0",
							CHART_COLOR[colorOf.get(segment.key) ?? "neutral"].bg,
							segment === lastUp && "rounded-t-sm",
							segment === lastDown && "rounded-b-sm",
						),
					),
					h.Style({ top: `${top}%`, bottom: `${bottom}%` }),
				])
			}),
		)
	}

	return h.div(
		[
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge("flex min-w-0 flex-col", options.className)),
		],
		[
			h.div(
				[h.Class(twMerge("flex", options.heightClass ?? "h-56"))],
				[
					yAxis(
						h,
						domain.ticks.map((tick) => ({ y: y(tick), label: formatAxis(tick) })),
					),
					h.div(
						[h.Class("relative min-w-0 flex-1"), h.OnMouseLeave(options.onHover(null))],
						[
							...(hovered === null
								? []
								: [
										h.span([
											h.AriaHidden(true),
											h.Class("pointer-events-none absolute inset-y-0 bg-fg/5"),
											h.Style({
												left: `${xAt(hovered) - band / 2}%`,
												width: `${band}%`,
											}),
										]),
									]),
							gridlines(
								h,
								domain.ticks.map((tick) => ({ y: y(tick), isZero: tick === 0 })),
							),
							...options.bars.map(bar),
							...(options.netLabel
								? [
										percentSvg(h, [
											strokePath(
												h,
												linePath(
													options.bars.map(
														(entry, index) => [xAt(index), y(entry.net)] as const,
													),
												),
												CHART_COLOR.net.stroke,
												1.5,
											),
										]),
										...options.bars.map((entry, index) =>
											plotDot(
												h,
												xAt(index),
												y(entry.net),
												twMerge("size-2 ring-0", CHART_COLOR.net.bg),
											),
										),
									]
								: []),
							...(hovered === null || hoveredBar === undefined
								? []
								: [
										chartTooltip(h, {
											x: xAt(hovered) + band / 2,
											heading: hoveredBar.heading,
											rows: options.stacks
												.filter((stack) => (hoveredBar.values[stack.key] ?? 0) !== 0)
												.map((stack) => ({
													label: stack.label,
													value: options.formatValue(
														hoveredBar.values[stack.key] ?? 0,
													),
													color: stack.color,
												})),
											total: options.netLabel
												? {
														label: options.netLabel,
														value: options.formatValue(hoveredBar.net),
														color: "net" as const,
														mark: "line" as const,
													}
												: undefined,
										}),
									]),
							...hoverBands(h, xs, band, options.onHover),
						],
					),
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
								options.bars.flatMap((bar, index) =>
									ticks.has(index)
										? [{ x: xAt(index), label: bar.tick, isActive: index === hovered }]
										: [],
								),
							),
						],
					),
				],
			),
		],
	)
}

// MRR MOVEMENT
