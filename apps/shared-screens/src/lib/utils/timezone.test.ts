import { describe, expect, test } from "vitest"
import { formatTimezoneDelta } from "./timezone"

describe("formatTimezoneDelta", () => {
	// The viewer's own zone is the process's; compare against zones at a known offset from UTC.
	const at = new Date("2026-01-15T12:00:00.000Z")
	const viewerOffset = -at.getTimezoneOffset()

	test("says how far ahead or behind, in hours and minutes", () => {
		const delta = (zoneOffset: number) => zoneOffset - viewerOffset
		const expected = (minutes: number) => {
			if (minutes === 0) return ""
			const total = Math.abs(minutes)
			const parts = [
				Math.floor(total / 60) > 0 ? `${Math.floor(total / 60)}h` : "",
				total % 60 > 0 ? `${total % 60}m` : "",
			]
			return `${parts.filter(Boolean).join(" ")} ${minutes > 0 ? "ahead" : "behind"}`
		}
		expect(formatTimezoneDelta("Asia/Kolkata", at)).toBe(expected(delta(330)))
		expect(formatTimezoneDelta("America/New_York", at)).toBe(expected(delta(-300)))
		expect(formatTimezoneDelta("UTC", at)).toBe(expected(delta(0)))
	})

	test("is empty for no zone or an unknown one", () => {
		expect(formatTimezoneDelta(null, at)).toBe("")
		expect(formatTimezoneDelta("Not/AZone", at)).toBe("")
	})
})
