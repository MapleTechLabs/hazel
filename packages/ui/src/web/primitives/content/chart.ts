// Owned by lane A1 (`docs/hazel-ui-phase4.md`, W2a and W2b). `hz:chart`: today's hand-drawn SVG
// charts (`customers/charts`): the axis kinds (`chart/axes.ts`, W2a) and the small kinds without
// axes (`chart/small.ts`, W2b). Shared code: `chart/{scale,format,frame}.ts`.
import type { ChartSeries } from "../../../vocabulary/content.ts"
import type { ChartFormat, ChartSize } from "../../../vocabulary/options.ts"
import { loop } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { type AxisKind, type AxisLayout, drawHover, drawPlot, indexAt, layout } from "./chart/axes.ts"
import { legendEntries, xTicks, yTicks } from "./chart/frame.ts"
import { drawSmall, type SmallKind, smallKinds } from "./chart/small.ts"
import { ensureChartStyles } from "./chart/styles.ts"

const axisKinds: ReadonlySet<string> = new Set<AxisKind>(["line", "area", "bar", "stackedBar"])
const formats: ReadonlyArray<ChartFormat> = ["number", "currency", "percent", "duration"]
const isFormat = (value: unknown): value is ChartFormat => formats.some((format) => format === value)
const sizes: ReadonlyArray<ChartSize> = ["regular", "small", "large"]
const isSize = (value: unknown): value is ChartSize => sizes.some((size) => size === value)

const isSeries = (value: unknown): value is ChartSeries =>
	typeof value === "object" &&
	value !== null &&
	"key" in value &&
	typeof value.key === "string" &&
	"label" in value &&
	typeof value.label === "string" &&
	"tone" in value &&
	typeof value.tone === "string" &&
	"values" in value &&
	Array.isArray(value.values)

const strings = (value: unknown): ReadonlyArray<string> =>
	Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : []

export const primitive = definePrimitive("chart", ({ document, tag, outer }) => {
	ensureChartStyles(document)
	const node = outer("div")
	node.setAttribute("role", "img")
	const legend = part(document, "ul", "legend")
	const yAxis = part(document, "div", "axis")
	yAxis.dataset.axis = "y"
	yAxis.setAttribute("aria-hidden", "true")
	const plot = part(document, "div", "plot")
	const endAxis = part(document, "div", "axis")
	endAxis.dataset.axis = "end"
	endAxis.setAttribute("aria-hidden", "true")
	const xAxis = part(document, "div", "axis")
	xAxis.dataset.axis = "x"
	xAxis.setAttribute("aria-hidden", "true")
	const skeleton = part(document, "div", "skeleton")
	skeleton.setAttribute("aria-hidden", "true")
	const tooltip = part(document, "div", "tooltip")
	tooltip.setAttribute("role", "presentation")
	tooltip.hidden = true
	node.append(legend, yAxis, plot, endAxis, xAxis, skeleton)

	let kind = "line"
	let series: ReadonlyArray<ChartSeries> = []
	let labels: ReadonlyArray<string> = []
	let format: ChartFormat = "number"
	let currency = "USD"
	let net = false
	let size: ChartSize = "regular"
	let highlightFrom: number | undefined
	let plan: AxisLayout | undefined
	let resting: ReadonlyArray<Element> = []
	let hovered: number | null = null

	const drawHovered = () => {
		for (const tick of xAxis.children)
			if (tick instanceof HTMLElement) flag(tick, "active", tick.dataset.index === String(hovered))
		if (plan === undefined || hovered === null) {
			tooltip.hidden = true
			plot.replaceChildren(...resting, tooltip)
			return
		}
		const { behind, front } = drawHover(document, plan, hovered, tooltip)
		plot.replaceChildren(...behind, ...resting, ...front, tooltip)
	}

	const draw = () => {
		if (!axisKinds.has(kind)) {
			// The small kinds: no axes, legend, hover or tooltip, as today.
			plan = undefined
			hovered = null
			for (const axis of [legend, yAxis, endAxis, xAxis]) axis.replaceChildren()
			// SAFETY: a kind that is not an axis kind is a small kind (`ChartKind`); an unknown one draws a sparkline.
			const small = (smallKinds.has(kind) ? kind : "sparkline") as SmallKind
			resting = drawSmall(document, { kind: small, series, size, highlightFrom, net })
			drawHovered()
			return
		}
		// SAFETY: `axisKinds` holds exactly the `AxisKind` values.
		plan = layout({ kind: kind as AxisKind, series, labels, format, currency, net })
		if (hovered !== null && hovered >= plan.count) hovered = null
		legend.replaceChildren(...legendEntries(document, plan.legend))
		yAxis.replaceChildren(...yTicks(document, plan.yTicks))
		xAxis.replaceChildren(...xTicks(document, plan.xTicks))
		endAxis.replaceChildren(
			...(kind === "line" || kind === "area"
				? plan.endTicks.map((tick) => {
						const label = part(document, "span", "tick")
						label.style.top = `${tick.at}%`
						const value = part(document, "span", "tickValue")
						value.textContent = tick.value
						label.append(`${tick.label} `, value)
						return label
					})
				: []),
		)
		resting = drawPlot(document, plan)
		drawHovered()
	}

	const emit = (event: "hover" | "press", payload: { readonly index: number | null }) => {
		const events = primitive.events
		const handler = events?.handlers[event]
		if (events !== undefined && handler !== undefined) events.dispatch(event, handler, payload)
	}

	const hover = (index: number | null) => {
		if (index === hovered) return
		hovered = index
		drawHovered()
		emit("hover", { index })
	}

	const pointerIndex = (event: PointerEvent | MouseEvent) => {
		if (plan === undefined) return null
		const box = plot.getBoundingClientRect()
		return box.width <= 0 ? null : indexAt(plan, (event.clientX - box.left) / box.width)
	}
	plot.addEventListener("pointermove", (event) => hover(pointerIndex(event)))
	plot.addEventListener("pointerleave", () => hover(null))
	plot.addEventListener("click", (event) => {
		const index = pointerIndex(event)
		if (index !== null) emit("press", { index })
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "kind") {
				kind = typeof value === "string" ? value : "line"
				option(node, "kind", value)
			} else if (name === "series") series = Array.isArray(value) ? value.filter(isSeries) : []
			else if (name === "labels") labels = strings(value)
			else if (name === "format") format = isFormat(value) ? value : "number"
			else if (name === "currency") currency = typeof value === "string" && value !== "" ? value : "USD"
			else if (name === "net") net = value === true
			else if (name === "label") {
				if (typeof value === "string" && value !== "") node.setAttribute("aria-label", value)
				else node.removeAttribute("aria-label")
				return
			} else if (name === "size") {
				size = isSize(value) ? value : "regular"
				option(node, "size", value)
			} else if (name === "highlightFrom")
				highlightFrom = typeof value === "number" && Number.isFinite(value) ? value : undefined
			else if (name === "legend") return flag(node, "legend", value)
			else if (name === "loading") {
				flag(node, "loading", value)
				if (value === true) node.setAttribute("aria-busy", "true")
				else node.removeAttribute("aria-busy")
				loop(skeleton, value === true)
				return
			} else return
			draw()
		},
		events: undefined,
	}
	draw()
	return primitive
})
