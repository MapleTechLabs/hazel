import { describe, expect, it } from "vitest"
import { Option } from "effect"
import { calendarLayout, heatLevel, stepDay } from "./calendar-heatmap"

const days = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => ({
		day: new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10),
		value: 0,
	}))

describe("heatLevel", () => {
	it("is none for zero and at least one for any activity", () => {
		expect(heatLevel(0, 40)).toBe(0)
		expect(heatLevel(1, 40)).toBe(1)
		expect(heatLevel(20, 40)).toBe(2)
		expect(heatLevel(31, 40)).toBe(4)
		expect(heatLevel(40, 40)).toBe(4)
		expect(heatLevel(3, 0)).toBe(0)
	})
})

describe("calendarLayout", () => {
	it("puts Monday on top and starts a new column each week", () => {
		// 2026-11-18 is a Wednesday.
		const layout = calendarLayout(days("2026-11-18", 7))
		expect(layout.cells.map((cell) => [cell.week, cell.weekday])).toEqual([
			[0, 2],
			[0, 3],
			[0, 4],
			[0, 5],
			[0, 6],
			[1, 0],
			[1, 1],
		])
		expect(layout.weeks).toBe(2)
	})

	it("covers a year in 53 weeks and labels each month once, with room between", () => {
		const layout = calendarLayout(days("2025-11-23", 365))
		expect(layout.weeks).toBe(53)
		const labels = layout.months.map((month) => month.label)
		expect(new Set(labels).size).toBe(labels.length)
		for (const [index, month] of layout.months.entries()) {
			if (index > 0) expect(month.week - layout.months[index - 1].week).toBeGreaterThanOrEqual(3)
		}
	})

	it("labels a month starting in the last, partial week over that week, not past the grid", () => {
		// The year ends Tue 2026-12-01: December starts mid-week in the last column.
		const layout = calendarLayout(days("2025-12-02", 365))
		expect(layout.months.at(-1)).toEqual({ week: layout.weeks - 1, label: "Dec" })
		for (const month of layout.months) expect(month.week).toBeLessThan(layout.weeks)
	})

	it("shades days against the busiest one", () => {
		const points = days("2026-11-16", 3).map((point, index) => ({ ...point, value: [0, 2, 8][index] }))
		const layout = calendarLayout(points)
		expect(layout.max).toBe(8)
		expect(layout.cells.map((cell) => cell.level)).toEqual([0, 1, 4])
	})

	it("is empty with no points", () => {
		expect(calendarLayout([])).toEqual({ cells: [], weeks: 0, months: [], max: 0 })
	})
})

describe("stepDay", () => {
	it("starts on the latest day and moves a day vertically, a week sideways, within the year", () => {
		expect(stepDay("ArrowUp", null, 365)).toEqual(Option.some(363))
		expect(stepDay("ArrowLeft", 100, 365)).toEqual(Option.some(93))
		expect(stepDay("ArrowRight", 362, 365)).toEqual(Option.some(364))
		expect(stepDay("ArrowLeft", 3, 365)).toEqual(Option.some(0))
		expect(stepDay("Home", 200, 365)).toEqual(Option.some(0))
		expect(stepDay("Escape", 200, 365)).toEqual(Option.some(null))
		expect(stepDay("a", 200, 365)).toEqual(Option.none())
	})
})
