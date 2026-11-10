import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { clamp } from "./scale"

/**
 * What the axis charts share: the palette, the card, the legend, the axes and the hover tooltip.
 * Charts own no state: the page keeps the hovered index and passes it back in.
 */

/** A chart color token (`theme.css` › Customers). */
export type ChartColor =
	| "series-1"
	| "series-2"
	| "series-3"
	| "new"
	| "expansion"
	| "contraction"
	| "churn"
	| "neutral"
	| "net"

/** Literal classes per color, so Tailwind sees every one. */
export const CHART_COLOR = {
	"series-1": { bg: "bg-chart-series-1", stroke: "stroke-chart-series-1" },
	"series-2": { bg: "bg-chart-series-2", stroke: "stroke-chart-series-2" },
	"series-3": { bg: "bg-chart-series-3", stroke: "stroke-chart-series-3" },
	new: { bg: "bg-chart-new", stroke: "stroke-chart-new" },
	expansion: { bg: "bg-chart-expansion", stroke: "stroke-chart-expansion" },
	contraction: { bg: "bg-chart-contraction", stroke: "stroke-chart-contraction" },
	churn: { bg: "bg-chart-churn", stroke: "stroke-chart-churn" },
	neutral: { bg: "bg-chart-neutral", stroke: "stroke-chart-neutral" },
	net: { bg: "bg-chart-net", stroke: "stroke-chart-net" },
} as const satisfies Record<ChartColor, Readonly<{ bg: string; stroke: string }>>

export type LegendItem = Readonly<{ label: string; color: ChartColor; mark?: "line" | "square" }>

const swatch = <M>(h: HtmlBuilder<M>, color: ChartColor, mark: "line" | "square" | "dot"): Html =>
	h.span([
		h.AriaHidden(true),
		h.Class(
			twMerge(
				"shrink-0",
				CHART_COLOR[color].bg,
				mark === "line"
					? "h-0.5 w-3 rounded-full"
					: mark === "dot"
						? "size-2 rounded-full"
						: "size-2.5 rounded-[2px]",
			),
		),
	])

export const chartLegend = <M>(h: HtmlBuilder<M>, items: ReadonlyArray<LegendItem>): Html =>
	h.ul(
		[h.Class("flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-fg text-sm")],
		items.map((item) =>
			h.li(
				[h.Class("inline-flex items-center gap-1.5")],
				[swatch(h, item.color, item.mark ?? "square"), item.label],
			),
		),
	)

/** The chart's card: title, description and legend over the chart. */
export const chartCard = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		description?: string
		/** Right of the title: a legend, a toggle. */
		aside?: Html
		className?: string
	}>,
	children: ReadonlyArray<Html>,
): Html =>
	h.section(
		[
			h.Class(
				twMerge(
					"flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5",
					options.className,
				),
			),
		],
		[
			h.header(
				[h.Class("flex flex-wrap items-start justify-between gap-x-6 gap-y-2")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-col gap-0.5")],
						[
							h.h2([h.Class("font-semibold text-base/6 text-fg")], [options.title]),
							...(options.description
								? [h.p([h.Class("text-muted-fg text-sm")], [options.description])]
								: []),
						],
					),
					...(options.aside ? [options.aside] : []),
				],
			),
			...children,
		],
	)

/** One tooltip row: swatch, label, value. */
export type TooltipRow = Readonly<{
	label: string
	value: string
	color: ChartColor
	mark?: "line" | "square" | "dot"
}>

/**
 * The hover tooltip beside the crosshair at `x` (percent of the plot): right of it in the left
 * 60%, left of it past that, so it never leaves the plot.
 */
export const chartTooltip = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ x: number; heading: string; rows: ReadonlyArray<TooltipRow>; total?: TooltipRow }>,
): Html => {
	const onRight = options.x <= 60
	const row = (entry: TooltipRow, emphasis: boolean) =>
		h.div(
			[h.Class("contents")],
			[
				swatch(h, entry.color, entry.mark ?? "square"),
				h.span([h.Class(emphasis ? "font-medium text-fg" : "text-muted-fg")], [entry.label]),
				h.span([h.Class("text-right font-medium text-fg tabular-nums")], [entry.value]),
			],
		)
	return h.div(
		[
			h.Role("presentation"),
			h.Class(
				"pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-fg/10 bg-overlay px-3 py-2.5 text-overlay-fg text-sm shadow-md",
			),
			h.Style(
				onRight
					? { left: `calc(${clamp(options.x, 0, 100)}% + 12px)` }
					: { right: `calc(${clamp(100 - options.x, 0, 100)}% + 12px)` },
			),
		],
		[
			h.p([h.Class("mb-2 font-medium text-fg")], [options.heading]),
			h.div(
				[h.Class("grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1.5")],
				[
					...options.rows.map((entry) => row(entry, false)),
					...(options.total
						? [
								h.div([h.Class("col-span-3 my-0.5 border-border border-t")]),
								row(options.total, true),
							]
						: []),
				],
			),
		],
	)
}

/** Y-axis tick labels, right-aligned in the gutter, centred on their gridline. */
export const yAxis = <M>(
	h: HtmlBuilder<M>,
	ticks: ReadonlyArray<Readonly<{ y: number; label: string }>>,
): Html =>
	h.div(
		[h.AriaHidden(true), h.Class("relative w-12 shrink-0")],
		ticks.map((tick) =>
			h.span(
				[
					h.Class(
						"absolute right-2 -translate-y-1/2 whitespace-nowrap text-muted-fg text-xs tabular-nums",
					),
					h.Style({ top: `${tick.y}%` }),
				],
				[tick.label],
			),
		),
	)

/** Gridlines across the plot; the zero line is stronger. */
export const gridlines = <M>(
	h: HtmlBuilder<M>,
	ticks: ReadonlyArray<Readonly<{ y: number; isZero: boolean }>>,
): Html =>
	h.div(
		[h.AriaHidden(true), h.Class("pointer-events-none absolute inset-0")],
		ticks.map((tick) =>
			h.span([
				h.Class(
					twMerge(
						"absolute inset-x-0 border-t",
						tick.isZero ? "border-fg-2/50" : "border-chart-grid",
					),
				),
				h.Style({ top: `${tick.y}%` }),
			]),
		),
	)

/** X-axis labels under the plot, centred on their x; `isActive` marks the hovered one. */
export const xAxis = <M>(
	h: HtmlBuilder<M>,
	ticks: ReadonlyArray<Readonly<{ x: number; label: string; isActive?: boolean }>>,
): Html =>
	h.div(
		[h.AriaHidden(true), h.Class("relative h-6")],
		ticks.map((tick) =>
			h.span(
				[
					h.Class(
						twMerge(
							"absolute top-1.5 -translate-x-1/2 whitespace-nowrap text-xs tabular-nums",
							tick.isActive ? "font-medium text-fg" : "text-muted-fg",
							tick.x <= 0 && "translate-x-0",
							tick.x >= 100 && "-translate-x-full",
						),
					),
					h.Style({ left: `${tick.x}%` }),
				],
				[tick.label],
			),
		),
	)

/**
 * Invisible full-height hover targets, one per index, each `[x - width / 2, x + width / 2]`
 * (clipped to the plot). Leaving the plot clears the hover (the plot's own `OnMouseLeave`).
 */
export const hoverBands = <M>(
	h: HtmlBuilder<M>,
	xs: ReadonlyArray<number>,
	width: number,
	onHover: (index: number | null) => M,
): ReadonlyArray<Html> =>
	xs.map((x, index) => {
		const left = clamp(x - width / 2, 0, 100)
		const right = clamp(x + width / 2, 0, 100)
		return h.span([
			h.AriaHidden(true),
			h.Class("absolute inset-y-0 z-[1]"),
			h.Style({ left: `${left}%`, width: `${right - left}%` }),
			h.OnMouseEnter(onHover(index)),
		])
	})

/** The SVG layer in percent space: drawn shapes stretch with the box, strokes keep their width. */
export const percentSvg = <M>(h: HtmlBuilder<M>, children: ReadonlyArray<Html>): Html =>
	h.svg(
		[
			h.AriaHidden(true),
			h.Attribute("viewBox", "0 0 100 100"),
			h.Attribute("preserveAspectRatio", "none"),
			h.Class("pointer-events-none absolute inset-0 size-full overflow-visible"),
		],
		[...children],
	)

/** A stroke that keeps its pixel width however the SVG stretches. */
export const strokePath = <M>(h: HtmlBuilder<M>, d: string, className: string, width = 1.75): Html =>
	h.path([
		h.Attribute("d", d),
		h.Attribute("fill", "none"),
		h.Attribute("stroke-width", String(width)),
		h.Attribute("stroke-linejoin", "round"),
		h.Attribute("stroke-linecap", "round"),
		h.Attribute("vector-effect", "non-scaling-stroke"),
		h.Class(className),
	])

/** A dot at `(x, y)` percent, drawn in HTML so it stays round. */
export const plotDot = <M>(h: HtmlBuilder<M>, x: number, y: number, className: string): Html =>
	h.span([
		h.AriaHidden(true),
		h.Class(
			twMerge(
				"pointer-events-none absolute z-[2] size-2.5 -translate-1/2 rounded-full ring-2 ring-bg",
				className,
			),
		),
		h.Style({ left: `${x}%`, top: `${y}%` }),
	])
