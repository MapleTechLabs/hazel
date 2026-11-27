// Owned by lane A1 (`docs/hazel-ui-phase4.md`, W2a and W2b). `hz:chart`: today's hand-drawn SVG
// charts (`customers/charts`). W2a draws the axis kinds; the small kinds (sparkline, barSparkline,
// distribution) are W2b's and draw a stub until then. Shared code: `chart/{scale,format,frame}.ts`.
import type { ChartSeries } from "../../../vocabulary/content.ts"
import type { ChartFormat } from "../../../vocabulary/options.ts"
import { loop } from "../../motion.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { type AxisKind, type AxisLayout, drawHover, drawPlot, indexAt, layout } from "./chart/axes.ts"
import { legendEntries, xTicks, yTicks } from "./chart/frame.ts"
import { ensureChartStyles } from "./chart/styles.ts"

const axisKinds: ReadonlySet<string> = new Set<AxisKind>(["line", "area", "bar", "stackedBar"])
const formats: ReadonlyArray<ChartFormat> = ["number", "currency", "percent", "duration"]
const isFormat = (value: unknown): value is ChartFormat => formats.some((format) => format === value)

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
			// W2b's kinds: a stub the runner reports as not implemented, until that lane draws them.
			plan = undefined
			const stub = part(document, "span", "stub")
			stub.dataset.hzStub = "A1"
			stub.textContent = `hz:chart ${kind}: lane W2b`
			resting = [stub]
			for (const axis of [legend, yAxis, endAxis, xAxis]) axis.replaceChildren()
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
			} else if (name === "size") return option(node, "size", value)
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
