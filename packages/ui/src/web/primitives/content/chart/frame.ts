/**
 * The DOM every axis chart shares (today's `customers/charts/frame.ts`): the legend, the y and x
 * axes, gridlines, the percent-space SVG layer, dots and the hover tooltip. Pure builders over a
 * `Document`; the kinds (`axes.ts`) decide what to draw, the primitive (`chart.ts`) when.
 */
import type { ChartTone } from "../../../../vocabulary/content.ts"
import { part } from "../../define.ts"
import { clamp } from "./scale.ts"

const SVG = "http://www.w3.org/2000/svg"

export type Mark = "square" | "dot" | "line"

/** A swatch in a tone; `net` takes the net line's colour instead. */
export const swatch = (document: Document, tone: ChartTone | "net", mark: Mark) => {
	const node = part(document, "span", "swatch")
	node.setAttribute("aria-hidden", "true")
	node.dataset.mark = mark
	if (tone === "net") node.dataset.net = ""
	else node.dataset.tone = tone
	return node
}

export interface LegendEntry {
	readonly label: string
	readonly tone: ChartTone | "net"
	readonly mark: Mark
}

/** The legend's entries, a swatch and a label each (`chartLegend`). */
export const legendEntries = (document: Document, entries: ReadonlyArray<LegendEntry>) =>
	entries.map((entry) => {
		const item = part(document, "li", "legendItem")
		item.append(swatch(document, entry.tone, entry.mark), entry.label)
		return item
	})

export interface Tick {
	readonly at: number
	readonly label: string
}

/** Y tick labels, right-aligned in the gutter and centred on their gridline (`yAxis`). */
export const yTicks = (document: Document, ticks: ReadonlyArray<Tick>) =>
	ticks.map((tick) => {
		const node = part(document, "span", "tick")
		node.style.top = `${tick.at}%`
		node.textContent = tick.label
		return node
	})

/**
 * X labels under the plot, centred on their x (`xAxis`). Labels at the plot's edges align inward;
 * a phone keeps the first, middle and last (`data-thin` marks the rest, `data-active` the hovered).
 */
export const xTicks = (document: Document, ticks: ReadonlyArray<Tick & { readonly index: number }>) => {
	const last = ticks.length - 1
	const middle = Math.floor(last / 2)
	return ticks.map((tick, position) => {
		const node = part(document, "span", "tick")
		node.style.left = `${tick.at}%`
		node.dataset.index = String(tick.index)
		node.textContent = tick.label
		if (tick.at <= 4) node.dataset.edge = "start"
		else if (tick.at >= 96) node.dataset.edge = "end"
		if (position === 0) node.dataset.first = ""
		if (position === last && position > 0) node.dataset.last = ""
		if (ticks.length > 3 && position !== 0 && position !== middle && position !== last)
			node.dataset.thin = ""
		return node
	})
}

/** Gridlines across the plot at each tick; the zero line is stronger. */
export const gridlines = (
	document: Document,
	ticks: ReadonlyArray<{ readonly at: number; readonly zero: boolean }>,
) => {
	const layer = part(document, "div", "layer")
	layer.setAttribute("aria-hidden", "true")
	for (const tick of ticks) {
		const line = part(document, "span", "gridline")
		line.style.top = `${tick.at}%`
		if (tick.zero) line.dataset.zero = ""
		layer.append(line)
	}
	return layer
}

/** The SVG layer in percent space: shapes stretch with the box, strokes keep their pixel width. */
export const percentSvg = (document: Document) => {
	const svg = document.createElementNS(SVG, "svg")
	svg.setAttribute("data-hz-part", "layer")
	svg.setAttribute("aria-hidden", "true")
	svg.setAttribute("viewBox", "0 0 100 100")
	svg.setAttribute("preserveAspectRatio", "none")
	return svg
}

/** A line (`fill: none`) or the fill under one, in a tone or the net colour. */
export const svgPath = (
	document: Document,
	d: string,
	drawn: "line" | "area",
	tone: ChartTone | "net",
	width = 1.75,
) => {
	const path = document.createElementNS(SVG, "path")
	path.setAttribute("data-hz-part", drawn)
	path.setAttribute("d", d)
	if (tone === "net") path.setAttribute("data-net", "")
	else path.setAttribute("data-tone", tone)
	if (drawn === "line") {
		path.setAttribute("stroke-width", String(width))
		path.setAttribute("stroke-linejoin", "round")
		path.setAttribute("stroke-linecap", "round")
		path.setAttribute("vector-effect", "non-scaling-stroke")
	}
	return path
}

/** A dot at `(x, y)` percent, drawn in HTML so it stays round. */
export const dot = (document: Document, x: number, y: number, tone: ChartTone | "net") => {
	const node = part(document, "span", "dot")
	node.style.left = `${x}%`
	node.style.top = `${y}%`
	if (tone === "net") node.dataset.net = ""
	else node.dataset.tone = tone
	return node
}

export interface TooltipRow {
	readonly label: string
	readonly value: string
	readonly tone: ChartTone | "net"
	readonly mark: Mark
}

const tooltipRow = (document: Document, row: TooltipRow, total: boolean) => {
	const node = part(document, "div", "tooltipRow")
	if (total) node.dataset.total = ""
	const label = part(document, "span", "tooltipLabel")
	label.textContent = row.label
	const value = part(document, "span", "tooltipValue")
	value.textContent = row.value
	node.append(swatch(document, row.tone, row.mark), label, value)
	return node
}

/**
 * Fills the tooltip beside the crosshair at `x` (percent of the plot): right of it in the left
 * 60%, left of it past that, so it never leaves the plot (`chartTooltip`).
 */
export const fillTooltip = (
	tooltip: HTMLElement,
	options: {
		readonly x: number
		readonly heading: string
		readonly rows: ReadonlyArray<TooltipRow>
		readonly total?: TooltipRow | undefined
	},
) => {
	const document = tooltip.ownerDocument
	const heading = part(document, "div", "tooltipHeading")
	heading.textContent = options.heading
	const rows = part(document, "div", "tooltipRows")
	rows.append(...options.rows.map((row) => tooltipRow(document, row, false)))
	if (options.total !== undefined)
		rows.append(part(document, "div", "tooltipRule"), tooltipRow(document, options.total, true))
	tooltip.replaceChildren(heading, rows)
	const onRight = options.x <= 60
	tooltip.style.left = onRight ? `calc(${clamp(options.x, 0, 100)}% + var(--hz-space-3))` : ""
	tooltip.style.right = onRight ? "" : `calc(${clamp(100 - options.x, 0, 100)}% + var(--hz-space-3))`
	tooltip.hidden = false
}
