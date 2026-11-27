/**
 * The axis-free kinds (lane W2b, today's `customers/charts/sparkline.ts` and `distribution.ts`): a
 * sparkline, the evidence bars with a highlighted tail and a dashed baseline, and a 100% bar. Pure
 * builders over a `Document`, drawn into the chart's plot; sizes and colours are `styles.ts`'s.
 */
import type { ChartSeries, ChartTone } from "../../../../vocabulary/content.ts"
import type { ChartSize } from "../../../../vocabulary/options.ts"
import { part } from "../../define.ts"
import { areaPath, bandWidth, extent, linePath, seriesPoints } from "./scale.ts"

const SVG = "http://www.w3.org/2000/svg"

export type SmallKind = "sparkline" | "barSparkline" | "distribution"

export const smallKinds: ReadonlySet<string> = new Set<SmallKind>([
	"sparkline",
	"barSparkline",
	"distribution",
])

export interface SmallInput {
	readonly kind: SmallKind
	readonly series: ReadonlyArray<ChartSeries>
	readonly size: ChartSize
	/** Bars from this index on are the recent window (`barSparkline`). */
	readonly highlightFrom: number | undefined
	/** `barSparkline`: the dashed baseline at the mean before `highlightFrom`. */
	readonly net: boolean
}

const numbers = (series: ChartSeries | undefined): ReadonlyArray<number> =>
	series === undefined ? [] : series.values.filter((value): value is number => value !== null)

/**
 * The sparkline's viewBox per size, today's `SIZE` (`sm` 80x24, `md` 120x32). HAZEL-GAP(sparkline-marks):
 * today's `area` and `endDot` are their own options; here `regular` is the inline line with its end
 * dot, `small` the bare line (table cells), `large` the card line over its fill (KPI tiles).
 */
const sparkBox = {
	small: [80, 24],
	regular: [80, 24],
	large: [120, 32],
} as const satisfies Record<ChartSize, readonly [number, number]>

const svgNode = (document: Document, name: string, attributes: Readonly<Record<string, string>>) => {
	const node = document.createElementNS(SVG, name)
	for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
	return node
}

const sparkline = (document: Document, input: SmallInput): Element => {
	const series = input.series[0]
	const [width, height] = sparkBox[input.size]
	const tone: ChartTone = series?.tone ?? "neutral"
	// Inset by the dot's radius, so the end dot and a 1.5px stroke never clip.
	const points = seriesPoints(numbers(series), { width, height, inset: 2.5 })
	const svg = svgNode(document, "svg", {
		"data-hz-part": "spark",
		"data-tone": tone,
		"aria-hidden": "true",
	})
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
	if (input.size === "large")
		svg.append(svgNode(document, "path", { "data-hz-part": "area", d: areaPath(points, height) }))
	svg.append(
		svgNode(document, "path", {
			"data-hz-part": "line",
			d: linePath(points),
			"stroke-width": "1.5",
			"stroke-linejoin": "round",
			"stroke-linecap": "round",
		}),
	)
	const last = points.at(-1)
	if (input.size === "regular" && last !== undefined)
		svg.append(
			svgNode(document, "circle", {
				"data-hz-part": "endDot",
				cx: String(last[0]),
				cy: String(last[1]),
				r: "2.5",
			}),
		)
	return svg
}

/** The mean of the values before `from`, or of all of them (the evidence's baseline average). */
export const baselineOf = (values: ReadonlyArray<number>, from: number | undefined): number | null => {
	const before = from === undefined ? values : values.slice(0, Math.max(0, from))
	return before.length === 0 ? null : before.reduce((sum, value) => sum + value, 0) / before.length
}

const barSparkline = (document: Document, input: SmallInput): ReadonlyArray<Element> => {
	const series = input.series[0]
	const values = series === undefined ? [] : series.values.map((value) => value ?? 0)
	// HAZEL-GAP(chart-baseline): today's baseline is the evidence's own average; here `net` draws the
	// mean of the bars before `highlightFrom`.
	const baseline = input.net ? baselineOf(values, input.highlightFrom) : null
	const [, hi] = extent([...values, baseline ?? 0])
	const top = hi === 0 ? 1 : hi
	const width = bandWidth(values.length)
	const bars = values.map((value, index) => {
		const bar = part(document, "span", "bar")
		const recent = input.highlightFrom === undefined || index >= input.highlightFrom
		if (recent) bar.dataset.tone = series?.tone ?? "neutral"
		else bar.dataset.rest = ""
		bar.style.width = `${width}%`
		bar.style.height = `${(Math.max(0, value) / top) * 100}%`
		return bar
	})
	if (baseline === null) return bars
	const line = part(document, "span", "baseline")
	line.setAttribute("aria-hidden", "true")
	line.style.bottom = `${(baseline / top) * 100}%`
	return [...bars, line]
}

/** Each series' share of the bar: the sum of its values; zero segments are left out. */
const distribution = (document: Document, input: SmallInput): ReadonlyArray<Element> => {
	const totals = input.series.map((series) => ({
		tone: series.tone,
		value: numbers(series).reduce((sum, value) => sum + Math.max(0, value), 0),
	}))
	const total = totals.reduce((sum, each) => sum + each.value, 0)
	if (total === 0) return []
	return totals
		.filter((each) => each.value > 0)
		.map((each) => {
			const segment = part(document, "span", "share")
			segment.dataset.tone = each.tone
			segment.style.width = `${(each.value / total) * 100}%`
			return segment
		})
}

const drawers = {
	sparkline: (document, input) => [sparkline(document, input)],
	barSparkline,
	distribution,
} satisfies Record<SmallKind, (document: Document, input: SmallInput) => ReadonlyArray<Element>>

/** What a small kind draws in the plot. */
export const drawSmall = (document: Document, input: SmallInput): ReadonlyArray<Element> =>
	drawers[input.kind](document, input)
