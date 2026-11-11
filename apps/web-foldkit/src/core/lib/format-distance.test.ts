import { describe, expect, test } from "vitest"
import { formatDistanceToNow } from "./format-distance"

const NOW = Date.UTC(2026, 2, 12, 12, 0)
const MINUTE = 60_000
const DAY = 1440

describe("formatDistanceToNow", () => {
	const ago = (minutes: number) => formatDistanceToNow(NOW - minutes * MINUTE, NOW)

	test("words a past time against the given clock", () => {
		expect(ago(0)).toBe("less than a minute ago")
		expect(ago(1)).toBe("1 minute ago")
		expect(ago(44)).toBe("44 minutes ago")
		expect(ago(60)).toBe("about 1 hour ago")
		expect(ago(168)).toBe("about 3 hours ago")
		expect(ago(26 * 60)).toBe("1 day ago")
		expect(ago(9 * DAY)).toBe("9 days ago")
		expect(ago(40 * DAY)).toBe("about 1 month ago")
		expect(ago(100 * DAY)).toBe("3 months ago")
		expect(ago(400 * DAY)).toBe("about 1 year ago")
	})

	test("takes a Date as well as a timestamp", () => {
		expect(formatDistanceToNow(new Date(NOW - 30 * MINUTE), NOW)).toBe("30 minutes ago")
	})

	test("words a future time with `in`", () => {
		expect(formatDistanceToNow(NOW + 2 * DAY * MINUTE, NOW)).toBe("in 2 days")
	})
})
