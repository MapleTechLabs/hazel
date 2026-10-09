import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { AnnounceSegmentValue, FocusSegment, init, Message, update } from "./date-segments"

/** useDateSegment spin, typing, navigation and clearing rules, for date and time segments. */

/** The placeholder is the `today` passed to init, so spinning an empty segment is deterministic. */
const today = "2026-03-12"
const date = (value?: string) =>
	init({ id: "due", kind: "date", today, ...(value === undefined ? {} : { value }) })
const time = (value?: string) => init({ id: "at", kind: "time", ...(value === undefined ? {} : { value }) })

const press = (segment: string, key: string) => message(Message.PressedSegmentKey({ segment, key }))
const announced = (valueText: string) => [
	Command.expectExact(AnnounceSegmentValue({ valueText })),
	Command.resolve(AnnounceSegmentValue, Message.CompletedAnnounceValue()),
]
const movedTo = (elementId: string) => [
	Command.expectExact(FocusSegment({ elementId })),
	Command.resolve(FocusSegment, Message.CompletedFocusSegment()),
]

describe("date segments story", () => {
	test("ArrowUp past December wraps the month to January and announces it", () => {
		story(
			update,
			given(date("2026-12-05")),
			press("month", "ArrowUp"),
			...announced("1 – January"),
			model((next) => {
				expect(next.values.month).toBe(1)
				expect(next.committed).toBe("2026-01-05")
			}),
		)
	})

	test("ArrowDown below the first day of a 31-day month wraps to 31", () => {
		story(
			update,
			given(date("2026-03-01")),
			press("day", "ArrowDown"),
			...announced("31"),
			model((next) => expect(next.committed).toBe("2026-03-31")),
		)
	})

	// T7: the day limit is the month's length, so February wraps to the 28th.
	test("ArrowDown below the first day of February wraps to the 28th", () => {
		story(
			update,
			given(date("2026-02-01")),
			press("day", "ArrowDown"),
			...announced("28"),
			model((next) => {
				expect(next.values.day).toBe(28)
				expect(next.committed).toBe("2026-02-28")
			}),
		)
	})

	test("ArrowUp on an empty segment fills it from the placeholder instead of stepping", () => {
		story(
			update,
			given(date()),
			press("month", "ArrowUp"),
			...announced("3 – March"),
			model((next) => {
				expect(next.values.month).toBe(3)
				expect(next.committed).toBeNull()
			}),
		)
	})

	test("Home and End jump a segment to its minimum and maximum", () => {
		story(
			update,
			given(date("2026-06-15")),
			press("day", "Home"),
			...announced("1"),
			model((next) => expect(next.values.day).toBe(1)),
			press("day", "End"),
			...announced("30"),
			model((next) => {
				expect(next.values.day).toBe(30)
				expect(next.committed).toBe("2026-06-30")
			}),
		)
	})

	test("typing 1 waits for a second month digit, then 2 completes December and moves to the day", () => {
		story(
			update,
			given(date()),
			press("month", "1"),
			...announced("1 – January"),
			model((next) => expect([next.values.month, next.enteredKeys]).toEqual([1, "1"])),
			press("month", "2"),
			...movedTo("due-day"),
			model((next) => {
				expect(next.values.month).toBe(12)
				expect(next.enteredKeys).toBe("")
				expect(next.activeSegment).toBe("day")
			}),
		)
	})

	test("a second digit that overflows the month starts over with that digit", () => {
		story(
			update,
			given(date()),
			press("month", "1"),
			...announced("1 – January"),
			press("month", "3"),
			...movedTo("due-day"),
			model((next) => expect(next.values.month).toBe(3)),
		)
	})

	test("a letter in a numeric segment does nothing", () => {
		story(
			update,
			given(date("2026-06-15")),
			press("day", "x"),
			Command.expectNone(),
			model((next) => expect(next.values.day).toBe(15)),
		)
	})

	test("ArrowLeft and ArrowRight move between segments and stop at the ends", () => {
		story(
			update,
			given(date("2026-06-15")),
			press("day", "ArrowRight"),
			...movedTo("due-year"),
			press("year", "ArrowRight"),
			Command.expectNone(),
			press("year", "ArrowLeft"),
			...movedTo("due-day"),
			model((next) => expect([next.activeSegment, next.pendingFocusMoves]).toEqual(["day", 0])),
		)
	})

	test("Backspace drops the last digit, then clears the segment, then moves to the previous one", () => {
		story(
			update,
			given(date("2026-06-15")),
			press("day", "Backspace"),
			...announced("1"),
			model((next) => expect(next.values.day).toBe(1)),
			press("day", "Backspace"),
			...announced("Empty"),
			model((next) => {
				expect(next.values.day).toBeNull()
				// Clearing a segment keeps the last complete value.
				expect(next.committed).toBe("2026-06-01")
			}),
			press("day", "Backspace"),
			...movedTo("due-month"),
			model((next) => expect(next.activeSegment).toBe("month")),
		)
	})

	test("ArrowUp on 12 o'clock wraps the hour to 1 and keeps the day period", () => {
		story(
			update,
			given(time("00:30")),
			press("hour", "ArrowUp"),
			Command.expectHas(AnnounceSegmentValue),
			Command.resolve(AnnounceSegmentValue, Message.CompletedAnnounceValue()),
			model((next) => {
				expect([next.values.hour, next.values.dayPeriod]).toEqual([1, 0])
				expect(next.committed).toBe("01:30:00")
			}),
		)
	})

	test("PageUp and PageDown snap minutes to quarter hours, and ArrowUp wraps 59 to 00", () => {
		story(
			update,
			given(time("09:07")),
			press("minute", "PageUp"),
			...announced("15"),
			model((next) => expect(next.values.minute).toBe(15)),
			press("minute", "PageDown"),
			...announced("00"),
			model((next) => expect(next.values.minute).toBe(0)),
			press("minute", "ArrowDown"),
			...announced("59"),
			press("minute", "ArrowUp"),
			...announced("00"),
			model((next) => expect(next.committed).toBe("09:00:00")),
		)
	})

	test("typing p in the day period switches to PM", () => {
		story(
			update,
			given(time("09:15")),
			press("dayPeriod", "p"),
			...announced("PM"),
			model((next) => {
				expect(next.values.dayPeriod).toBe(1)
				expect(next.committed).toBe("21:15:00")
			}),
			press("dayPeriod", "x"),
			Command.expectNone(),
		)
	})

	test("typing an hour on an empty time fills the day period from the placeholder", () => {
		story(
			update,
			given(time()),
			press("hour", "3"),
			...movedTo("at-minute"),
			model((next) => {
				expect([next.values.hour, next.values.dayPeriod]).toEqual([3, 0])
				expect(next.committed).toBeNull()
			}),
		)
	})
})
