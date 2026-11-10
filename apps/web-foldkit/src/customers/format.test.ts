import { DateTime } from "effect"
import { describe, expect, it } from "vitest"
import {
	bucketLabels,
	daysBetween,
	deltaTone,
	formatCompact,
	formatCount,
	formatDate,
	formatDateTime,
	formatDayLong,
	formatDaysLeft,
	formatDeltaPct,
	formatDeltaPoints,
	formatMoney,
	formatMoneyCompact,
	formatPct,
	formatRelative,
	currencySymbol,
	formatMajor,
	toMajor,
	toMinor,
} from "./format"

const NOW = new Date("2026-11-10T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe("money", () => {
	it("formats minor units", () => {
		expect(formatMoney(4_821_000)).toBe("$48,210")
		expect(formatMoney(124_000, "USD", { cents: true })).toBe("$1,240.00")
		expect(formatMoney(0)).toBe("$0")
		expect(formatMoney(-100_000)).toBe("−$1,000")
		expect(formatMoney(940_000, "USD", { signed: true })).toBe("+$9,400")
		expect(formatMoney(5_000, "JPY")).toBe("¥5,000")
		expect(toMajor(5_000, "JPY")).toBe(5_000)
		expect(formatMoney(4_821_000, "EUR")).toBe("€48,210")
	})

	it("reads typed amounts and labels them in the currency's own units", () => {
		expect(toMinor(12.34)).toBe(1_234)
		expect(toMinor(5_000, "JPY")).toBe(5_000)
		expect(formatMajor(215_000)).toBe("2150.00")
		expect(formatMajor(5_000, "JPY")).toBe("5000")
		expect(currencySymbol("EUR")).toBe("€")
		expect(currencySymbol("JPY")).toBe("¥")
		expect(currencySymbol("XYZ1")).toBe("XYZ1")
	})

	it("formats compact money", () => {
		expect(formatMoneyCompact(4_821_000)).toBe("$48.2K")
		expect(formatMoneyCompact(94_000)).toBe("$940")
		expect(formatMoneyCompact(-400_000)).toBe("−$4K")
		expect(formatMoneyCompact(160_000_000)).toBe("$1.6M")
		expect(formatMoneyCompact(360_000, "USD", { signed: true })).toBe("+$3.6K")
	})

	it("never shows a minus on zero, and survives an unknown currency", () => {
		expect(formatMoney(-40)).toBe("$0")
		expect(formatMoney(-40, "USD", { cents: true })).toBe("−$0.40")
		expect(formatMoney(-50)).toBe("−$1")
		expect(formatMoneyCompact(-4)).toBe("$0")
		expect(formatMoney(123_456, "NOPE")).toBe("1,235 NOPE")
		expect(formatMoneyCompact(-480_000, "NOPE")).toBe("−4.8K NOPE")
	})
})

describe("numbers", () => {
	it("formats counts and compact values", () => {
		expect(formatCount(1611)).toBe("1,611")
		expect(formatCompact(461_000)).toBe("461K")
		expect(formatCompact(500_000)).toBe("500K")
		expect(formatCompact(980)).toBe("980")
	})

	it("formats percents and deltas", () => {
		expect(formatPct(61)).toBe("61%")
		expect(formatPct(2.8)).toBe("2.8%")
		expect(formatPct(0)).toBe("0%")
		expect(formatDeltaPct(6.2)).toBe("+6.2%")
		expect(formatDeltaPct(-38)).toBe("−38%")
		expect(formatDeltaPct(0, { digits: 1 })).toBe("0%")
		expect(formatDeltaPoints(0.9)).toBe("+0.9 pt")
		expect(formatDeltaPoints(-20, "pts")).toBe("−20 pts")
	})

	it("reads a delta's tone from the metric's good direction", () => {
		expect(deltaTone(6.2)).toBe("positive")
		expect(deltaTone(-1)).toBe("negative")
		expect(deltaTone(0.9, "down")).toBe("negative")
		expect(deltaTone(-0.9, "down")).toBe("positive")
		expect(deltaTone(0)).toBe("neutral")
		expect(deltaTone(null)).toBe("neutral")
	})
})

describe("time", () => {
	it("formats relative ages", () => {
		expect(formatRelative(ago(10_000), NOW)).toBe("just now")
		expect(formatRelative(ago(4 * MINUTE), NOW)).toBe("4m ago")
		expect(formatRelative(ago(2 * HOUR), NOW)).toBe("2h ago")
		expect(formatRelative(ago(18 * DAY), NOW)).toBe("18d ago")
		expect(formatRelative(ago(95 * DAY), NOW)).toBe("3mo ago")
		expect(formatRelative(ago(800 * DAY), NOW)).toBe("2y ago")
		expect(formatRelative(new Date(NOW.getTime() + 4 * DAY), NOW)).toBe("in 4d")
	})

	it("accepts DateTime.Utc as well as Date", () => {
		expect(formatRelative(DateTime.makeUnsafe(ago(3 * DAY)), NOW)).toBe("3d ago")
		expect(daysBetween(DateTime.makeUnsafe(ago(18 * DAY + HOUR)), NOW)).toBe(18)
	})

	it("formats days left", () => {
		expect(formatDaysLeft(4)).toBe("4 days left")
		expect(formatDaysLeft(1)).toBe("1 day left")
		expect(formatDaysLeft(0)).toBe("Ends today")
		expect(formatDaysLeft(-2)).toBe("Ended 2 days ago")
	})

	it("formats dates, adding the year outside the current one", () => {
		const nov9 = new Date("2026-11-09T18:42:00Z")
		expect(formatDate(nov9, { now: NOW, timeZone: "UTC" })).toBe("Nov 9")
		expect(formatDate(new Date("2025-03-02T10:00:00Z"), { now: NOW, timeZone: "UTC" })).toBe(
			"Mar 2, 2025",
		)
		expect(formatDateTime(nov9, { timeZone: "UTC" })).toBe("Nov 9, 18:42")
	})

	it("labels UTC days and chart buckets", () => {
		expect(formatDayLong("2026-11-01")).toBe("Sun, Nov 1")
		expect(bucketLabels("day", "2026-10-12")).toEqual({ tick: "Oct 12", heading: "Mon, Oct 12" })
		expect(bucketLabels("week", "2026-10-12")).toEqual({ tick: "Oct 12", heading: "Week of Oct 12" })
		expect(bucketLabels("month", "2026-10-01")).toEqual({ tick: "Oct", heading: "October 2026" })
	})
})
