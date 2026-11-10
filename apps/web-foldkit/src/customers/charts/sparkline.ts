import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { DeltaTone } from "../format"
import { areaPath, bandWidth, clamp, extent, linePath, seriesPoints } from "./scale"

/**
 * Small, axis-free charts (Foundations › Sparkline Variants, Evidence Row): line sparklines, mini
 * bars, a limit meter and the evidence bars with a highlighted window and a dashed baseline.
 * Each is a labelled image (`role="img"`): the caller's `ariaLabel` says what it shows.
 */

const STROKE = {
	positive: "stroke-chart-new",
	negative: "stroke-chart-churn",
	neutral: "stroke-chart-neutral",
} as const satisfies Record<DeltaTone, string>
const FILL = {
	positive: "fill-chart-new/12",
	negative: "fill-chart-churn/12",
	neutral: "fill-chart-neutral/12",
} as const satisfies Record<DeltaTone, string>
const DOT = {
	positive: "fill-chart-new",
	negative: "fill-chart-churn",
	neutral: "fill-chart-neutral",
} as const satisfies Record<DeltaTone, string>

/** Inline (80×24, table cells and queue rows) or card (120×32, KPI tiles). */
export type SparklineSize = "sm" | "md"

const SIZE = {
	sm: [80, 24, "h-6 w-20"],
	md: [120, 32, "h-8 w-30"],
} as const satisfies Record<SparklineSize, readonly [number, number, string]>

/** Up, down or flat by first vs last value. */
export const trendTone = (values: ReadonlyArray<number>): DeltaTone => {
	const first = values[0]
	const last = values.at(-1)
	if (values.length < 2 || first === undefined || last === undefined) return "neutral"
	return last > first ? "positive" : last < first ? "negative" : "neutral"
}

export const sparkline = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		values: ReadonlyArray<number>
		ariaLabel: string
		/** Defaults to the trend of the values. */
		tone?: DeltaTone
		size?: SparklineSize
		/** A soft fill under the line (cards). */
		area?: boolean
		/** A dot on the last value (inline). */
		endDot?: boolean
		className?: string
	}>,
): Html => {
	const [width, height, sizeClass] = SIZE[options.size ?? "sm"]
	const tone = options.tone ?? trendTone(options.values)
	// Inset by the dot's radius, so the end dot and a 1.5px stroke never clip.
	const points = seriesPoints(options.values, { width, height, inset: 2.5 })
	const last = points[points.length - 1]
	return h.svg(
		[
			h.Attribute("viewBox", `0 0 ${width} ${height}`),
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge("shrink-0 overflow-visible", sizeClass, options.className)),
		],
		[
			...(options.area
				? [h.path([h.Attribute("d", areaPath(points, height)), h.Class(FILL[tone])])]
				: []),
			h.path([
				h.Attribute("d", linePath(points)),
				h.Attribute("fill", "none"),
				h.Attribute("stroke-width", "1.5"),
				h.Attribute("stroke-linejoin", "round"),
				h.Attribute("stroke-linecap", "round"),
				h.Class(STROKE[tone]),
			]),
			...(options.endDot && last !== undefined
				? [
						h.circle([
							h.Attribute("cx", String(last[0])),
							h.Attribute("cy", String(last[1])),
							h.Attribute("r", "2.5"),
							h.Class(DOT[tone]),
						]),
					]
				: []),
		],
	)
}

/** Mini bars (e.g. daily active users, 14 days); the last bar can stand out as "today". */
export const barSparkline = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		values: ReadonlyArray<number>
		ariaLabel: string
		highlightLast?: boolean
		className?: string
	}>,
): Html => {
	const [, hi] = extent(options.values)
	const width = bandWidth(options.values.length)
	return h.div(
		[
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge("flex h-6 w-20 shrink-0 items-end gap-px", options.className)),
		],
		options.values.map((value, index) =>
			h.span([
				h.Class(
					twMerge(
						"block min-h-px rounded-[1px] bg-chart-neutral",
						options.highlightLast && index === options.values.length - 1 && "bg-chart-series-2",
					),
				),
				h.Style({ width: `${width}%`, height: `${hi === 0 ? 0 : (value / hi) * 100}%` }),
			]),
		),
	)
}

/** A limit meter: `value` of `limit`, blue under the limit, amber at it, red past it. */
export const meter = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ value: number; limit: number; ariaLabel: string; className?: string }>,
): Html => {
	const pct = options.limit <= 0 ? 0 : (options.value / options.limit) * 100
	return h.div(
		[
			h.Role("meter"),
			h.AriaLabel(options.ariaLabel),
			h.AriaValuemin(0),
			h.AriaValuemax(options.limit),
			h.AriaValuenow(options.value),
			h.Class(twMerge("h-1 w-20 overflow-hidden rounded-full bg-secondary", options.className)),
		],
		[
			h.div([
				h.Class(
					twMerge(
						"h-full rounded-full",
						pct >= 120
							? "bg-chart-churn"
							: pct >= 100
								? "bg-chart-contraction"
								: "bg-chart-expansion",
					),
				),
				h.Style({ width: `${clamp(pct, 0, 100)}%` }),
			]),
		],
	)
}

/**
 * Daily bars with the recent window highlighted and the baseline average dashed across: the
 * evidence of a usage drop ("7-day avg vs prior 28-day avg").
 */
export const evidenceBars = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		values: ReadonlyArray<number>
		/** Bars from this index on are the recent window. */
		highlightFrom: number
		/** The dashed line, e.g. the baseline average; omitted when null. */
		baseline: number | null
		ariaLabel: string
		tone?: DeltaTone
		className?: string
	}>,
): Html => {
	const [, hi] = extent([...options.values, options.baseline ?? 0])
	const top = hi === 0 ? 1 : hi
	const width = bandWidth(options.values.length)
	const recent =
		options.tone === "positive"
			? "bg-chart-new"
			: options.tone === "neutral"
				? "bg-chart-series-2"
				: "bg-chart-churn"
	return h.div(
		[
			h.Role("img"),
			h.AriaLabel(options.ariaLabel),
			h.Class(twMerge("relative flex h-16 w-full items-end gap-px", options.className)),
		],
		[
			...options.values.map((value, index) =>
				h.span([
					h.Class(
						twMerge(
							"block min-h-px rounded-t-[2px]",
							index >= options.highlightFrom ? recent : "bg-chart-neutral/60",
						),
					),
					h.Style({ width: `${width}%`, height: `${(value / top) * 100}%` }),
				]),
			),
			...(options.baseline === null
				? []
				: [
						h.span([
							h.AriaHidden(true),
							h.Class(
								"pointer-events-none absolute inset-x-0 border-fg-2 border-t border-dashed",
							),
							h.Style({ bottom: `${(options.baseline / top) * 100}%` }),
						]),
					]),
		],
	)
}
