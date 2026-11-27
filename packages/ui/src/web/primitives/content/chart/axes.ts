/**
 * The axis kinds of `hz:chart`: `line` and `area` (today's `line-chart.ts`), `stackedBar` and `bar`
 * (`stacked-bar-chart.ts`; `bar` sets one series per bar side by side). `layout` is pure (tested);
 * `drawPlot` and `drawHover` turn it into DOM through `frame.ts`.
 */
import type { ChartSeries } from "../../../../vocabulary/content.ts"
import type { ChartFormat } from "../../../../vocabulary/options.ts"
import { part } from "../../define.ts"
import { chartFormatter, type ChartFormatter } from "./format.ts"
import {
	dot,
	gridlines,
	type LegendEntry,
	percentSvg,
	svgPath,
	type Tick,
	type TooltipRow,
	fillTooltip,
} from "./frame.ts"
import {
	areaPath,
	bandWidth,
	bandX,
	linePath,
	niceTicks,
	type Point,
	pointX,
	scaleLinear,
	spreadLabels,
	stackExtent,
	stackSegments,
	tickIndexes,
} from "./scale.ts"

const MINUTE = 60_000
const HOUR = 3_600_000

export type AxisKind = "line" | "area" | "bar" | "stackedBar"

export interface AxisInput {
	readonly kind: AxisKind
	readonly series: ReadonlyArray<ChartSeries>
	readonly labels: ReadonlyArray<string>
	/** The tooltip's heading per label, when longer than the tick. */
	readonly headings?: ReadonlyArray<string>
	readonly format: ChartFormat
	readonly currency: string
	readonly net: boolean
}

/** One bar's rectangle in percent of the plot: `left`/`width` across, `from`/`to` in value space. */
export interface BarRect {
	readonly key: string
	readonly tone: ChartSeries["tone"]
	readonly left: number
	readonly width: number
	readonly top: number
	readonly bottom: number
	readonly cap: "up" | "down" | undefined
}

export interface AxisLayout {
	readonly input: AxisInput
	readonly count: number
	readonly isBars: boolean
	readonly formatter: ChartFormatter
	readonly y: (value: number) => number
	readonly xAt: (index: number) => number
	readonly band: number
	readonly yTicks: ReadonlyArray<Tick & { readonly zero: boolean }>
	readonly xTicks: ReadonlyArray<Tick & { readonly index: number }>
	readonly endTicks: ReadonlyArray<Tick & { readonly value: string }>
	readonly legend: ReadonlyArray<LegendEntry>
	readonly bars: ReadonlyArray<BarRect>
	/** Each series' runs of present values, as points (a null breaks the line). */
	readonly lines: ReadonlyArray<{
		readonly series: ChartSeries
		readonly runs: ReadonlyArray<ReadonlyArray<Point>>
	}>
	/** The net per label (the sum of the present values), when `net` is on a bar kind. */
	readonly nets: ReadonlyArray<number> | undefined
}

const valueAt = (series: ChartSeries, index: number): number | null => series.values[index] ?? null

/** Splits a series into runs of present values, each a list of points. */
const runsOf = (
	series: ChartSeries,
	count: number,
	xAt: (index: number) => number,
	y: (value: number) => number,
) => {
	const runs: Array<Array<Point>> = []
	let run: Array<Point> = []
	for (let index = 0; index < count; index++) {
		const value = valueAt(series, index)
		if (value === null) {
			if (run.length > 0) runs.push(run)
			run = []
		} else run.push([xAt(index), y(value)])
	}
	if (run.length > 0) runs.push(run)
	return runs
}

/** Where everything goes, in percent of the plot; no DOM. */
export const layout = (input: AxisInput): AxisLayout => {
	const count = input.labels.length
	const isBars = input.kind === "bar" || input.kind === "stackedBar"
	const present = input.series.flatMap((series) =>
		series.values.slice(0, count).filter((value): value is number => value !== null),
	)
	const signed = present.some((value) => value < 0)
	const formatter = chartFormatter(input.format, input.currency, signed)
	// Counts get whole ticks (today's `integerTicks` for counts and usage).
	const integer = input.format === "number" && present.every(Number.isInteger)
	const perLabel = Array.from({ length: count }, (_, index) =>
		input.series.map((series) => valueAt(series, index) ?? 0),
	)
	const nets =
		isBars && input.net
			? perLabel.map((values) => values.reduce((sum, value) => sum + value, 0))
			: undefined
	const [lo, hi] =
		input.kind === "stackedBar"
			? stackExtent(perLabel, nets ?? [])
			: [Math.min(0, ...present, ...(nets ?? [])), Math.max(0, ...present, ...(nets ?? []))]
	// Durations tick in whole hours or minutes, not in milliseconds (today's charts pass hours).
	const unit = input.format === "duration" ? (Math.max(-lo, hi) >= HOUR ? HOUR : MINUTE) : 1
	const scaled = niceTicks(lo / unit, hi / unit, isBars ? 5 : 4, { integer })
	const domain = {
		min: scaled.min * unit,
		max: scaled.max * unit,
		ticks: scaled.ticks.map((tick) => tick * unit),
	}
	const y = scaleLinear([domain.min, domain.max], [100, 0])
	const xAt = (index: number) => (isBars ? bandX(index, count) : pointX(index, count))
	const band = isBars ? bandWidth(count) : count <= 1 ? 100 : 100 / (count - 1)
	// Line charts label about 5 dates; bars every month, or about 6 when there are days (`maxXTicks`).
	const maxTicks = isBars ? (count > 13 ? 6 : 12) : 5
	const lines = isBars
		? []
		: input.series.map((series) => ({ series, runs: runsOf(series, count, xAt, y) }))
	const lastValues = isBars
		? []
		: input.series.map((series) => {
				for (let index = count - 1; index >= 0; index--) {
					const value = valueAt(series, index)
					if (value !== null) return value
				}
				return null
			})
	const endAt = spreadLabels(
		lastValues.map((value) => y(value ?? 0)),
		9,
	)
	return {
		input,
		count,
		isBars,
		formatter,
		y,
		xAt,
		band,
		yTicks: domain.ticks.map((tick) => ({ at: y(tick), label: formatter.axis(tick), zero: tick === 0 })),
		xTicks: tickIndexes(count, maxTicks).map((index) => ({
			index,
			at: xAt(index),
			label: input.labels[index] ?? "",
		})),
		endTicks: input.series.flatMap((series, index) => {
			const value = lastValues[index]
			return value === null || value === undefined
				? []
				: [{ at: endAt[index] ?? 0, label: series.label, value: formatter.value(value) }]
		}),
		legend: [
			...input.series
				// A bar series with nothing in range is left out (today's reactivation).
				.filter((series) => !isBars || series.values.some((value) => value !== null && value !== 0))
				.map((series): LegendEntry => ({
					label: series.label,
					tone: series.tone,
					mark: isBars ? "square" : "line",
				})),
			// The net line's word is the renderer's (`chart-net-label`): every page says "Net".
			...(nets === undefined
				? []
				: [{ label: "Net", tone: "net", mark: "line" } satisfies LegendEntry]),
		],
		bars: isBars ? barsOf(input, count, y, xAt, band) : [],
		lines,
		nets,
	}
}

const barsOf = (
	input: AxisInput,
	count: number,
	y: (value: number) => number,
	xAt: (index: number) => number,
	band: number,
): ReadonlyArray<BarRect> => {
	const toneOf = new Map(input.series.map((series) => [series.key, series.tone]))
	const rects: Array<BarRect> = []
	const width = Math.min(band * 0.55, 8)
	for (let index = 0; index < count; index++) {
		const center = xAt(index)
		if (input.kind === "stackedBar" || input.series.length <= 1) {
			const segments = stackSegments(
				input.series.map((series) => ({ key: series.key, value: valueAt(series, index) ?? 0 })),
			)
			const lastUp = segments.findLast((segment) => segment.to > 0)
			const lastDown = segments.findLast((segment) => segment.to < 0)
			for (const segment of segments)
				rects.push({
					key: segment.key,
					tone: toneOf.get(segment.key) ?? "neutral",
					left: center - width / 2,
					width,
					top: Math.min(y(segment.from), y(segment.to)),
					bottom: 100 - Math.max(y(segment.from), y(segment.to)),
					cap: segment === lastUp ? "up" : segment === lastDown ? "down" : undefined,
				})
			continue
		}
		// Grouped: the series side by side inside a wider group, each from zero.
		const group = Math.min(band * 0.8, width * input.series.length)
		const each = group / input.series.length
		input.series.forEach((series, position) => {
			const value = valueAt(series, index)
			if (value === null || value === 0) return
			rects.push({
				key: series.key,
				tone: series.tone,
				left: center - group / 2 + position * each,
				width: each,
				top: Math.min(y(0), y(value)),
				bottom: 100 - Math.max(y(0), y(value)),
				cap: value > 0 ? "up" : "down",
			})
		})
	}
	return rects
}

/** The index under a pointer at `fraction` (0 to 1) of the plot's width: nearest point, or the band. */
export const indexAt = (plan: AxisLayout, fraction: number): number | null => {
	if (plan.count === 0) return null
	const clamped = Math.min(1, Math.max(0, fraction))
	return plan.isBars
		? Math.min(plan.count - 1, Math.floor(clamped * plan.count))
		: plan.count <= 1
			? 0
			: Math.round(clamped * (plan.count - 1))
}

/** The plot's resting layers: gridlines, then bars or lines, then the net line and its dots. */
export const drawPlot = (document: Document, plan: AxisLayout): ReadonlyArray<Element> => {
	const layers: Array<Element> = [gridlines(document, plan.yTicks)]
	if (plan.isBars) {
		const bars = part(document, "div", "layer")
		bars.setAttribute("aria-hidden", "true")
		for (const rect of plan.bars) {
			const segment = part(document, "span", "segment")
			segment.dataset.tone = rect.tone
			if (rect.cap !== undefined) segment.dataset.cap = rect.cap
			// Insets, not a height: a percentage height needs the parent's resolved height.
			segment.style.left = `${rect.left}%`
			segment.style.width = `${rect.width}%`
			segment.style.top = `${rect.top}%`
			segment.style.bottom = `${rect.bottom}%`
			bars.append(segment)
		}
		layers.push(bars)
	}
	const svg = percentSvg(document)
	for (const { series, runs } of plan.lines)
		for (const run of runs) {
			if (plan.input.kind === "area")
				svg.append(svgPath(document, areaPath(run, plan.y(0)), "area", series.tone))
			svg.append(svgPath(document, linePath(run), "line", series.tone))
		}
	if (plan.nets !== undefined)
		svg.append(
			svgPath(
				document,
				linePath(plan.nets.map((value, index): Point => [plan.xAt(index), plan.y(value)])),
				"line",
				"net",
				1.5,
			),
		)
	if (svg.childNodes.length > 0) layers.push(svg)
	if (plan.nets !== undefined) {
		const dots = part(document, "div", "layer")
		dots.setAttribute("aria-hidden", "true")
		plan.nets.forEach((value, index) => dots.append(dot(document, plan.xAt(index), plan.y(value), "net")))
		layers.push(dots)
	}
	return layers
}

/**
 * What the hovered index adds: a band behind the bar or a crosshair with a dot per series, and the
 * tooltip's rows (bars leave out empty and zero values, as today).
 */
export const drawHover = (
	document: Document,
	plan: AxisLayout,
	index: number,
	tooltip: HTMLElement,
): { readonly behind: ReadonlyArray<Element>; readonly front: ReadonlyArray<Element> } => {
	const x = plan.xAt(index)
	const heading = plan.input.headings?.[index] ?? plan.input.labels[index] ?? ""
	if (plan.isBars) {
		const band = part(document, "span", "band")
		band.setAttribute("aria-hidden", "true")
		band.style.left = `${x - plan.band / 2}%`
		band.style.width = `${plan.band}%`
		const rows = plan.input.series.flatMap((series): ReadonlyArray<TooltipRow> => {
			const value = valueAt(series, index)
			return value === null || value === 0
				? []
				: [
						{
							label: series.label,
							value: plan.formatter.value(value),
							tone: series.tone,
							mark: "square",
						},
					]
		})
		const net = plan.nets?.[index]
		fillTooltip(tooltip, {
			x: x + plan.band / 2,
			heading,
			rows,
			total:
				net === undefined
					? undefined
					: { label: "Net", value: plan.formatter.value(net), tone: "net", mark: "line" },
		})
		return { behind: [band], front: [] }
	}
	const crosshair = part(document, "span", "crosshair")
	crosshair.setAttribute("aria-hidden", "true")
	crosshair.style.left = `${x}%`
	const dots = plan.input.series.flatMap((series) => {
		const value = valueAt(series, index)
		return value === null ? [] : [dot(document, x, plan.y(value), series.tone)]
	})
	fillTooltip(tooltip, {
		x,
		heading,
		rows: plan.input.series.flatMap((series): ReadonlyArray<TooltipRow> => {
			const value = valueAt(series, index)
			return value === null
				? []
				: [
						{
							label: series.label,
							value: plan.formatter.value(value),
							tone: series.tone,
							mark: "dot",
						},
					]
		}),
	})
	return { behind: [], front: [crosshair, ...dots] }
}
