// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { formatStatusExpirationAt } from "./menus"

/** The user menu's "Until ..." label reads the root's clock, never `new Date()` (legacy `formatStatusExpiration`). */

const nowMs = Date.UTC(2026, 0, 15, 9, 0)

describe("formatStatusExpirationAt", () => {
	test("no expiry, or one already past, shows nothing", () => {
		expect(formatStatusExpirationAt(null, nowMs)).toBeNull()
		expect(formatStatusExpirationAt(nowMs, nowMs)).toBeNull()
		expect(formatStatusExpirationAt(nowMs - 60_000, nowMs)).toBeNull()
	})

	test("under an hour shows minutes from the given clock", () => {
		expect(formatStatusExpirationAt(nowMs + 30 * 60_000, nowMs)).toBe("30 min")
		expect(formatStatusExpirationAt(nowMs + 30 * 60_000, nowMs + 10 * 60_000)).toBe("20 min")
	})

	test("later expiries show a time or a date, as legacy does", () => {
		const inThreeHours = nowMs + 3 * 3_600_000
		const time = new Date(inThreeHours).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		const isSameDay = new Date(inThreeHours).toDateString() === new Date(nowMs).toDateString()
		expect(formatStatusExpirationAt(inThreeHours, nowMs)).toBe(isSameDay ? time : `tomorrow ${time}`)
		const inThreeDays = nowMs + 3 * 86_400_000
		expect(formatStatusExpirationAt(inThreeDays, nowMs)).toBe(
			new Date(inThreeDays).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
		)
	})
})
