import { describe, expect, it } from "vitest"
import { snoozeInstantOf, snoozeKeyOfLeaf, snoozeLeafKey, snoozeUntil } from "./menus"

// Local time: snoozes wake at 9:00 in the viewer's zone.
const at = (year: number, month: number, day: number, hour = 14) => new Date(year, month - 1, day, hour, 30)

describe("snooze", () => {
	it("wakes at 9:00 tomorrow, in 3 days, or next Monday", () => {
		const tuesday = at(2026, 11, 10)
		expect(snoozeUntil("tomorrow", tuesday)).toEqual(new Date(2026, 10, 11, 9, 0))
		expect(snoozeUntil("in_3_days", tuesday)).toEqual(new Date(2026, 10, 13, 9, 0))
		expect(snoozeUntil("next_week", tuesday)).toEqual(new Date(2026, 10, 16, 9, 0))
	})

	it("treats a Monday's next week as the following Monday", () => {
		expect(snoozeUntil("next_week", at(2026, 11, 16))).toEqual(new Date(2026, 10, 23, 9, 0))
		expect(snoozeUntil("next_week", at(2026, 11, 15))).toEqual(new Date(2026, 10, 16, 9, 0))
	})

	it("reads menu keys back, submenu leaves included", () => {
		const now = at(2026, 11, 10)
		expect(snoozeKeyOfLeaf(snoozeLeafKey("in_3_days"))).toBe("in_3_days")
		expect(snoozeKeyOfLeaf(snoozeLeafKey("pick_date"))).toBe("pick_date")
		expect(snoozeKeyOfLeaf("assign")).toBeNull()
		expect(snoozeInstantOf("tomorrow", now)).toEqual(new Date(2026, 10, 11, 9, 0))
		expect(snoozeInstantOf("snooze:next_week", now)).toEqual(new Date(2026, 10, 16, 9, 0))
		expect(snoozeInstantOf("pick_date", now)).toBeNull()
		expect(snoozeInstantOf("done", now)).toBeNull()
	})
})
