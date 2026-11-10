import { describe, expect, it } from "vitest"
import {
	areaPath,
	bandWidth,
	bandX,
	extent,
	linePath,
	niceStep,
	niceTicks,
	pointX,
	scaleLinear,
	seriesPoints,
	spreadLabels,
	stackExtent,
	stackSegments,
	tickIndexes,
} from "./scale"

describe("scaleLinear", () => {
	it("maps the domain onto the range, inverted ranges included", () => {
		const y = scaleLinear([0, 2000], [100, 0])
		expect(y(0)).toBe(100)
		expect(y(2000)).toBe(0)
		expect(y(500)).toBe(75)
	})

	it("maps a zero-width domain to the range start", () => {
		expect(scaleLinear([5, 5], [100, 0])(5)).toBe(100)
	})
})

describe("niceTicks", () => {
	it("picks 1/2/2.5/5 steps", () => {
		expect(niceStep(2000, 4)).toBe(500)
		expect(niceStep(24_000, 6)).toBe(5_000)
		expect(niceStep(7, 4)).toBe(2)
		expect(niceStep(10, 4)).toBe(2.5)
	})

	it("covers the data with whole steps from zero", () => {
		expect(niceTicks(0, 1611, 4)).toEqual({ min: 0, max: 2000, ticks: [0, 500, 1000, 1500, 2000] })
		expect(niceTicks(250, 1611, 4).min).toBe(0)
	})

	it("spans negatives (MRR movement)", () => {
		const { min, max, ticks } = niceTicks(-5_000, 13_200, 6)
		expect(min).toBe(-5_000)
		expect(max).toBe(15_000)
		expect(ticks).toEqual([-5_000, 0, 5_000, 10_000, 15_000])
	})

	it("survives an empty or flat series and float drift", () => {
		expect(niceTicks(0, 0)).toEqual({ min: 0, max: 1, ticks: [0, 1] })
		expect(niceTicks(0, 0.3, 3).ticks).toEqual([0, 0.1, 0.2, 0.3])
	})
})

describe("positions", () => {
	it("spreads points edge to edge and bands center to center", () => {
		expect(pointX(0, 5)).toBe(0)
		expect(pointX(4, 5)).toBe(100)
		expect(pointX(0, 1)).toBe(50)
		expect(bandX(0, 4)).toBe(12.5)
		expect(bandX(3, 4)).toBe(87.5)
		expect(bandWidth(4)).toBe(25)
	})

	it("labels about `max` indexes, always the last", () => {
		expect(tickIndexes(3, 5)).toEqual([0, 1, 2])
		expect(tickIndexes(30, 5)).toEqual([1, 8, 15, 22, 29])
		expect(tickIndexes(12, 12)).toHaveLength(12)
		expect(tickIndexes(0, 5)).toEqual([])
	})

	it("computes extents", () => {
		expect(extent([3, -1, 7])).toEqual([-1, 7])
		expect(extent([])).toEqual([0, 0])
	})
})

describe("paths", () => {
	it("draws a line and its area", () => {
		const points = [
			[0, 50],
			[50, 25],
			[100, 75.555],
		] as const
		expect(linePath(points)).toBe("M0 50 L50 25 L100 75.56")
		expect(areaPath(points, 100)).toBe("M0 50 L50 25 L100 75.56 L100 100 L0 100 Z")
		expect(linePath([])).toBe("")
		expect(areaPath([], 100)).toBe("")
	})

	it("scales a series into a box, y up", () => {
		expect(seriesPoints([0, 5, 10], { width: 80, height: 24 })).toEqual([
			[0, 24],
			[40, 12],
			[80, 0],
		])
		expect(seriesPoints([3], { width: 80, height: 24 })[0]![0]).toBe(40)
	})
})

describe("spreadLabels", () => {
	it("keeps apart labels that would overlap, in input order", () => {
		expect(spreadLabels([20, 70, 72], 8)).toEqual([20, 70, 78])
		expect(spreadLabels([72, 70, 20], 8)).toEqual([78, 70, 20])
	})

	it("shifts a run pushed past the bottom back up", () => {
		expect(spreadLabels([96, 97, 98], 8)).toEqual([84, 92, 100])
	})
})

describe("stacking", () => {
	it("stacks positives up and negatives down, skipping zeros", () => {
		expect(
			stackSegments([
				{ key: "new", value: 9_400 },
				{ key: "expansion", value: 3_600 },
				{ key: "reactivation", value: 0 },
				{ key: "contraction", value: -1_000 },
				{ key: "churn", value: -2_600 },
			]),
		).toEqual([
			{ key: "new", from: 0, to: 9_400 },
			{ key: "expansion", from: 9_400, to: 13_000 },
			{ key: "contraction", from: 0, to: -1_000 },
			{ key: "churn", from: -1_000, to: -3_600 },
		])
	})

	it("finds the stacked extent, extra values included", () => {
		expect(
			stackExtent(
				[
					[5, 2, -1],
					[3, -4, -2],
				],
				[9],
			),
		).toEqual([-6, 9])
	})
})
