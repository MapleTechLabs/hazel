// @vitest-environment happy-dom
/** Lane W2a: `hz:chart`'s axis kinds: layout, formats, the DOM it draws, hover and press. */
import { describe, expect, it } from "vitest"
import type { ChartSeries } from "../../../../vocabulary/content.ts"
import type { Plain } from "../../define.ts"
import { create, type Primitive } from "../../../primitives.ts"
import { indexAt, layout } from "./axes.ts"
import { chartFormatter } from "./format.ts"

const mrr: ReadonlyArray<ChartSeries> = [
	{ key: "new", label: "New", tone: "new", values: [940000, 1210000, 870000] },
	{ key: "reactivation", label: "Reactivation", tone: "series2", values: [0, null, 0] },
	{ key: "churn", label: "Churned", tone: "churn", values: [-260000, null, -180000] },
]

const mount = (props: Readonly<Record<string, Plain>>, on: ReadonlyArray<string> = []) => {
	const primitive = create(document, "hz:chart") as Primitive
	const fired: Array<readonly [string, Plain]> = []
	primitive.events = {
		handlers: Object.fromEntries(on.map((name) => [name, name])),
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload])
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) primitive.set(name, value)
	document.body.append(primitive.outer)
	const plot = primitive.outer.querySelector<HTMLElement>("[data-hz-part=plot]")!
	plot.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 200 }) as DOMRect
	return { node: primitive.outer, plot, fired }
}

const parts = (node: Element, name: string) => [...node.querySelectorAll(`[data-hz-part=${name}]`)]

describe("chart formats", () => {
	it("prints money from minor units, signed when the chart has losses, compact on the axis", () => {
		const signed = chartFormatter("currency", "USD", true)
		expect(signed.value(940000)).toBe("+$9,400")
		expect(signed.value(-260000)).toBe("−$2,600")
		expect(signed.axis(1500000)).toBe("$15K")
		expect(chartFormatter("currency", "JPY", false).value(1200)).toBe("¥1,200")
	})

	it("prints durations from milliseconds and percents as percent numbers", () => {
		const duration = chartFormatter("duration", "USD", false)
		expect(duration.value(2 * 3_600_000 + 10 * 60_000)).toBe("2h 10m")
		expect(duration.axis(30 * 60_000)).toBe("30m")
		expect(duration.axis(1.5 * 3_600_000)).toBe("1.5h")
		expect(chartFormatter("percent", "USD", false).value(61.4)).toBe("61%")
		expect(chartFormatter("number", "USD", false).axis(1611)).toBe("1.6K")
	})
})

describe("chart layout", () => {
	it("stacks around zero with a net per label and leaves an empty series out of the legend", () => {
		const plan = layout({
			kind: "stackedBar",
			series: mrr,
			labels: ["Aug", "Sep", "Oct"],
			format: "currency",
			currency: "USD",
			net: true,
		})
		expect(plan.nets).toEqual([680000, 1210000, 690000])
		expect(plan.legend.map((entry) => entry.label)).toEqual(["New", "Churned", "Net"])
		expect(plan.yTicks.some((tick) => tick.zero)).toBe(true)
		// One bar per present, non-zero value; the top one rounded up, the bottom one down.
		expect(plan.bars.map((bar) => [bar.key, bar.cap])).toEqual([
			["new", "up"],
			["churn", "down"],
			["new", "up"],
			["new", "up"],
			["churn", "down"],
		])
	})

	it("breaks a line at a missing value and labels its last present value", () => {
		const plan = layout({
			kind: "line",
			series: [{ key: "dau", label: "DAU", tone: "series1", values: [3, null, 5, 4] }],
			labels: ["a", "b", "c", "d"],
			format: "number",
			currency: "USD",
			net: false,
		})
		expect(plan.lines[0]?.runs.map((run) => run.length)).toEqual([1, 2])
		expect(plan.endTicks.map((tick) => `${tick.label} ${tick.value}`)).toEqual(["DAU 4"])
		expect(plan.yTicks.map((tick) => tick.label)).toEqual(["0", "2", "4", "6"])
	})

	it("ticks durations in whole hours", () => {
		const plan = layout({
			kind: "bar",
			series: [
				{
					key: "value",
					label: "Median",
					tone: "series1",
					values: [3.2 * 3_600_000, null, 5 * 3_600_000],
				},
			],
			labels: ["a", "b", "c"],
			format: "duration",
			currency: "USD",
			net: false,
		})
		expect(plan.yTicks.map((tick) => tick.label)).toEqual(["0", "1h", "2h", "3h", "4h", "5h"])
	})

	it("finds the nearest point on a line and the band on bars", () => {
		const input = {
			series: mrr,
			labels: ["a", "b", "c"],
			format: "number",
			currency: "USD",
			net: false,
		} as const
		expect(indexAt(layout({ ...input, kind: "line" }), 0.3)).toBe(1)
		expect(indexAt(layout({ ...input, kind: "bar" }), 0.3)).toBe(0)
		expect(indexAt(layout({ ...input, kind: "bar" }), 1)).toBe(2)
	})
})

describe("hz:chart", () => {
	it("is a labelled image with its legend, axes and bars, its options as attributes", () => {
		const { node } = mount({
			kind: "stackedBar",
			label: "MRR movement",
			series: mrr,
			labels: ["Aug", "Sep", "Oct"],
			format: "currency",
			legend: true,
			net: true,
			size: "small",
		})
		expect(node.getAttribute("role")).toBe("img")
		expect(node.getAttribute("aria-label")).toBe("MRR movement")
		expect(node.dataset.kind).toBe("stackedBar")
		expect(node.dataset.size).toBe("small")
		expect(node.hasAttribute("data-legend")).toBe(true)
		expect(parts(node, "legendItem").map((item) => item.textContent)).toEqual(["New", "Churned", "Net"])
		expect(parts(node, "segment")).toHaveLength(5)
		expect(node.querySelectorAll("[data-axis=x] > [data-hz-part=tick]")).toHaveLength(3)
		expect(node.querySelector("[data-hz-part=line][data-net]")).not.toBeNull()
	})

	it("hovers the index under the pointer: crosshair, dots and tooltip, then clears on leave", () => {
		const { node, plot, fired } = mount(
			{
				label: "Active users",
				series: [{ key: "dau", label: "DAU", tone: "series1", values: [3, 4, 5] }],
				labels: ["Oct 1", "Oct 2", "Oct 3"],
			},
			["hover", "press"],
		)
		plot.dispatchEvent(new PointerEvent("pointermove", { clientX: 160, bubbles: true }))
		const tooltip = node.querySelector<HTMLElement>("[data-hz-part=tooltip]")!
		expect(tooltip.hidden).toBe(false)
		expect(tooltip.textContent).toContain("Oct 2")
		expect(tooltip.textContent).toContain("DAU4")
		expect(parts(node, "crosshair")).toHaveLength(1)
		expect(node.querySelector("[data-axis=x] [data-active]")?.textContent).toBe("Oct 2")
		plot.dispatchEvent(new MouseEvent("click", { clientX: 290, bubbles: true }))
		plot.dispatchEvent(new PointerEvent("pointerleave"))
		expect(tooltip.hidden).toBe(true)
		expect(parts(node, "crosshair")).toHaveLength(0)
		expect(fired).toEqual([
			["hover", { index: 1 }],
			["press", { index: 2 }],
			["hover", { index: null }],
		])
	})

	it("shows only its skeleton while loading", () => {
		const { node } = mount({ label: "MRR", loading: true })
		expect(node.hasAttribute("data-loading")).toBe(true)
		expect(node.getAttribute("aria-busy")).toBe("true")
		expect(node.querySelector("[data-hz-part=skeleton]")?.getAttribute("data-motion")).toBe("loop")
	})
})

/** Lane W2b: the small kinds draw their plot alone, with no axes, legend or hover. */
describe("hz:chart small kinds", () => {
	const seats: ChartSeries = { key: "seats", label: "Seats", tone: "new", values: [4, null, 6, 11] }

	it("draws a sparkline with its end dot inline, bare in a cell, over its fill on a card", () => {
		const inline = mount({ kind: "sparkline", label: "Seats", series: [seats] }, ["hover"])
		const svg = inline.node.querySelector("svg[data-hz-part=spark]")!
		expect(inline.node.getAttribute("role")).toBe("img")
		expect(svg.getAttribute("viewBox")).toBe("0 0 80 24")
		expect(svg.getAttribute("data-tone")).toBe("new")
		expect(parts(svg, "endDot")).toHaveLength(1)
		expect(parts(svg, "area")).toHaveLength(0)
		// Nulls are skipped: three points, the first inset by the dot's radius.
		expect(svg.querySelector("[data-hz-part=line]")?.getAttribute("d")).toMatch(
			/^M2\.5 [\d.]+ L[\d.]+ [\d.]+ L77\.5 2\.5$/,
		)
		inline.plot.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, bubbles: true }))
		expect(inline.fired).toEqual([])
		expect(parts(inline.node, "tick")).toHaveLength(0)

		const cell = mount({ kind: "sparkline", size: "small", series: [seats] })
		expect(parts(cell.node, "endDot")).toHaveLength(0)
		const card = mount({ kind: "sparkline", size: "large", series: [seats] })
		expect(card.node.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 120 32")
		expect(parts(card.node, "area")).toHaveLength(1)
	})

	it("highlights the evidence bars' tail and dashes the prior average", () => {
		const { node } = mount({
			kind: "barSparkline",
			series: [{ key: "calls", label: "Calls", tone: "churn", values: [10, 20, 30, 5] }],
			highlightFrom: 3,
			net: true,
		})
		const bars = parts(node, "bar") as Array<HTMLElement>
		expect(bars.map((bar) => bar.dataset.tone ?? "rest")).toEqual(["rest", "rest", "rest", "churn"])
		expect(bars.map((bar) => bar.style.height)).toEqual([
			"33.33333333333333%",
			"66.66666666666666%",
			"100%",
			"16.666666666666664%",
		])
		expect((parts(node, "baseline")[0] as HTMLElement).style.bottom).toBe("66.66666666666666%")
		const plain = mount({
			kind: "barSparkline",
			series: [{ key: "c", label: "C", tone: "series2", values: [1, 2] }],
		})
		expect(parts(plain.node, "baseline")).toHaveLength(0)
		expect(
			(parts(plain.node, "bar") as Array<HTMLElement>).every((bar) => bar.dataset.tone === "series2"),
		).toBe(true)
	})

	it("splits the 100% bar by each series' total, leaving zero shares out", () => {
		const { node } = mount({
			kind: "distribution",
			label: "Users by activity",
			series: [
				{ key: "active", label: "Active", tone: "new", values: [18] },
				{ key: "dormant", label: "Dormant", tone: "contraction", values: [0] },
				{ key: "never", label: "Never", tone: "neutral", values: [4, 2] },
			],
		})
		const shares = parts(node, "share") as Array<HTMLElement>
		expect(shares.map((share) => [share.dataset.tone, share.style.width])).toEqual([
			["new", "75%"],
			["neutral", "25%"],
		])
		expect(parts(mount({ kind: "distribution", series: [] }).node, "share")).toHaveLength(0)
	})
})
