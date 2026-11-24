import { describe, expect, test } from "vitest"
import { isReleaseTag, latestRelease, nextReleaseTag, parseReleaseTag } from "./releases.ts"

describe("server releases", () => {
	test("only server-vYYYY.MM.DD[.N] tags are releases; the desktop's v* tags are not", () => {
		expect(isReleaseTag("server-v2026.11.24")).toBe(true)
		expect(isReleaseTag("server-v2026.11.24.3")).toBe(true)
		expect(isReleaseTag("v1.3.0")).toBe(false)
		expect(isReleaseTag("server-v2026.1.2")).toBe(false)
		expect(parseReleaseTag("server-v2026.11.24")).toEqual([2026, 11, 24, 1])
	})

	test("the latest release sorts by date, then by the day's number", () => {
		expect(
			latestRelease([
				"v1.3.0",
				"server-v2026.11.24",
				"server-v2026.11.24.10",
				"server-v2026.11.24.2",
				"server-v2026.10.30",
			]),
		).toBe("server-v2026.11.24.10")
		expect(latestRelease(["v1.0.0"])).toBeUndefined()
	})

	test("the next tag numbers a second release on the same day", () => {
		const day = new Date("2026-11-24T18:00:00Z")
		expect(nextReleaseTag(day, [])).toBe("server-v2026.11.24")
		expect(nextReleaseTag(day, ["server-v2026.11.24"])).toBe("server-v2026.11.24.2")
		expect(nextReleaseTag(day, ["server-v2026.11.24", "server-v2026.11.24.2"])).toBe(
			"server-v2026.11.24.3",
		)
		expect(nextReleaseTag(day, ["server-v2026.11.23"])).toBe("server-v2026.11.24")
	})
})
