// @vitest-environment happy-dom
/** Lane W2b: `hz:heatmap`'s layout, its keys, selection, `select` and `scrollTo`. */
import { describe, expect, it } from "vitest"
import type { HeatmapDay } from "../../../../vocabulary/content.ts"
import { create, type Primitive } from "../../../primitives.ts"
import { scrollTo } from "../../list/scroll.ts"
import type { Plain } from "../../define.ts"
import { calendarLayout, formatDayLong, stepDay } from "./layout.ts"

const daysFrom = (start: string, count: number): ReadonlyArray<HeatmapDay> =>
	Array.from({ length: count }, (_, index) => {
		const date = new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000)
			.toISOString()
			.slice(0, 10)
		return { date, level: (index % 5) as HeatmapDay["level"], label: `${index} events` }
	})

const mount = (props: Readonly<Record<string, Plain>>) => {
	const primitive = create(document, "hz:heatmap") as Primitive
	const fired: Array<readonly [string, Plain]> = []
	primitive.events = {
		handlers: { select: "select" },
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload])
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) primitive.set(name, value)
	document.body.append(primitive.outer)
	const grid = primitive.outer.querySelector<HTMLElement>("[data-hz-part=grid]")!
	return { primitive, node: primitive.outer, grid, fired }
}

const key = (grid: HTMLElement, name: string) =>
	grid.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))

describe("heatmap layout", () => {
	it("puts Monday on top, a column per week, and labels a month over its first full week", () => {
		// 2026-10-28 is a Wednesday.
		const plan = calendarLayout(daysFrom("2026-10-28", 30))
		expect(plan.cells[0]).toMatchObject({ week: 0, weekday: 2 })
		expect(plan.cells[5]).toMatchObject({ week: 1, weekday: 0 })
		expect(plan.weeks).toBe(5)
		// October's partial first week gives way to November, which starts on a Sunday.
		expect(plan.months).toEqual([{ week: 1, label: "Nov" }])
		expect(formatDayLong("2026-11-20")).toBe("Fri, Nov 20")
	})

	it("leaves a missing day's square empty and sorts the days", () => {
		const plan = calendarLayout([
			{ date: "2026-11-04", level: 1, label: "b" },
			{ date: "2026-11-02", level: 2, label: "a" },
		])
		expect(plan.cells.map((cell) => [cell.day.label, cell.weekday])).toEqual([
			["a", 0],
			["b", 2],
		])
	})

	it("steps a day up and down, a week left and right, and leaves on Escape", () => {
		expect(stepDay("ArrowUp", 3, 10)).toBe(2)
		expect(stepDay("ArrowRight", 5, 10)).toBe(9)
		expect(stepDay("ArrowLeft", null, 10)).toBe(2)
		expect(stepDay("Home", 4, 10)).toBe(0)
		expect(stepDay("Escape", 4, 10)).toBeNull()
		expect(stepDay("a", 4, 10)).toBeUndefined()
		expect(stepDay("ArrowUp", null, 0)).toBeUndefined()
	})
})

describe("hz:heatmap", () => {
	it("draws a square per day by level, keyed by its date, under one labelled tab stop", () => {
		const { node, grid } = mount({ label: "Activity", days: daysFrom("2026-11-02", 14) })
		const cells = [...node.querySelectorAll<HTMLElement>("[data-hz-part=day]")]
		expect(cells).toHaveLength(14)
		expect(cells[1]?.dataset.level).toBe("1")
		expect(cells[13]?.dataset.hzKey).toBe("2026-11-15")
		expect(grid.getAttribute("role")).toBe("group")
		expect(grid.getAttribute("aria-label")).toBe("Activity. Use the arrow keys to read each day.")
		expect(grid.tabIndex).toBe(0)
		expect(node.querySelectorAll("[data-hz-part=swatch]")).toHaveLength(5)
		expect(node.querySelector<HTMLElement>("[data-hz-part=tooltip]")?.hidden).toBe(true)
	})

	it("shows the selected day's tooltip, a hovered day over it, and announces it", () => {
		const { node } = mount({
			label: "Activity",
			days: daysFrom("2026-11-02", 14),
			selected: "2026-11-04",
		})
		const tooltip = node.querySelector<HTMLElement>("[data-hz-part=tooltip]")!
		expect(tooltip.hidden).toBe(false)
		expect(tooltip.textContent).toBe("2 events · Wed, Nov 4")
		const cells = [...node.querySelectorAll<HTMLElement>("[data-hz-part=day]")]
		expect(cells[2]?.hasAttribute("data-active")).toBe(true)
		cells[9]?.dispatchEvent(new PointerEvent("pointerenter"))
		expect(tooltip.textContent).toBe("9 events · Wed, Nov 11")
		expect(node.querySelector("[data-hz-part=live]")?.textContent).toBe("9 events, Wed, Nov 11")
		node.querySelector("[data-hz-part=grid]")?.dispatchEvent(new PointerEvent("pointerleave"))
		expect(tooltip.textContent).toBe("2 events · Wed, Nov 4")
	})

	it("steps from the selected day with the arrow keys and raises select, and a click selects", () => {
		const { node, grid, fired } = mount({ days: daysFrom("2026-11-02", 14), selected: "2026-11-04" })
		grid.focus()
		key(grid, "ArrowRight")
		key(grid, "ArrowUp")
		key(grid, "Tab")
		key(grid, "Escape")
		node.querySelectorAll<HTMLElement>("[data-hz-part=day]")[0]?.click()
		expect(fired).toEqual([
			["select", { date: "2026-11-11" }],
			["select", { date: "2026-11-10" }],
			["select", { date: "2026-11-02" }],
		])
	})

	it("scrolls a day into view for scrollTo({key})", () => {
		const { node } = mount({ days: daysFrom("2026-11-02", 14) })
		const cell = node.querySelectorAll<HTMLElement>("[data-hz-part=day]")[6]!
		let scrolled = false
		cell.scrollIntoView = () => {
			scrolled = true
		}
		scrollTo(node, { key: "2026-11-08" })
		expect(scrolled).toBe(true)
	})
})
