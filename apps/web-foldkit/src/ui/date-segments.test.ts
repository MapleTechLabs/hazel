import { Array } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { AnnounceValue, FocusSegment, init, Message, type Model, update } from "./date-segments"

/**
 * useDateSegment typing: auto-advance never depends on the focus move having run. Story resolves
 * every Command before the next Message, so the racing cases fold update directly.
 */

const empty = init({ id: "start", kind: "date", today: "2026-10-09" })

/** Messages through update with no Command executed and nothing rendered in between. */
const dispatch = (start: Model, messages: ReadonlyArray<Message>) =>
	messages.reduce((current, next) => update(current, next).model, start)

const keys = (segment: string, typed: string) =>
	Array.map([...typed], (key) => Message.PressedSegmentKey({ segment, key }))

const completed = Message.CompletedFocusSegment()

describe("date segments", () => {
	test("keystrokes back to back, before any focus move runs, fill every segment", () => {
		// DOM focus never left the month: the two auto-advance moves are still pending.
		const typed = dispatch(empty, keys("month", "372026"))
		expect([typed.values.month, typed.values.day, typed.values.year]).toEqual([3, 7, 2026])
		expect(typed.committed).toBe("2026-03-07")
		expect(typed.pendingFocusMoves).toBe(2)
		expect(dispatch(typed, [completed, completed]).pendingFocusMoves).toBe(0)
	})

	test("a keystroke reaching the old segment after its focus move ran still lands in the new one", () => {
		const typed = dispatch(empty, [
			...keys("month", "3"),
			completed,
			...keys("day", "7"),
			// The move to the year has not run, so these come from the day segment.
			...keys("day", "20"),
			completed,
			...keys("year", "26"),
		])
		expect(typed.committed).toBe("2026-03-07")
		expect(typed.pendingFocusMoves).toBe(0)
	})

	test("once moves settle, the segment that had focus is the one typed into", () => {
		story(
			update,
			given(init({ id: "due", kind: "date", today: "2026-10-09", value: "2026-10-07" })),
			message(Message.PressedSegmentKey({ segment: "year", key: "1" })),
			Command.resolve(AnnounceValue, Message.CompletedAnnounceValue()),
			message(Message.PressedSegmentKey({ segment: "day", key: "4" })),
			Command.resolveAll([FocusSegment, completed], [AnnounceValue, Message.CompletedAnnounceValue()]),
			model((current) => {
				expect([current.values.day, current.values.year]).toEqual([4, 1])
				expect([current.activeSegment, current.pendingFocusMoves]).toEqual(["year", 0])
			}),
		)
	})
})
