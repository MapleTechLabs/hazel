// @vitest-environment jsdom
import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Calendar from "./calendar"
import { init, Message, OutMessage, update } from "./date-picker"
import * as Segments from "./date-segments"

/** React Aria DatePicker: the trigger toggles the calendar popover, a picked day commits and closes. */

const today = "2026-03-12"
const empty = init({ id: "due", today })
const withValue = init({ id: "due", today, value: "2026-03-18" })

const calendar = (inner: Calendar.Message) => message(Message.GotCalendarMessage({ message: inner }))
const segmentKey = (segment: string, key: string) =>
	message(Message.GotSegmentsMessage({ message: Segments.Message.PressedSegmentKey({ segment, key }) }))

const focused = Command.resolve(Segments.FocusSegment, Segments.Message.CompletedFocusSegment())
const announced = Command.resolve(Segments.AnnounceValue, Segments.Message.CompletedAnnounceValue())

/** The calendar's selection announcement; `Announce` is not exported from calendar.ts, so match the instance. */
const selectionAnnouncement = (date: string) => {
	const [announcement] =
		Calendar.update(Calendar.init({ id: "due-calendar", today }), Calendar.Message.ClickedCell({ date }))
			.commands ?? []
	return announcement
}
const resolveSelectionAnnouncement = (date: string) => {
	const announcement = selectionAnnouncement(date)
	return announcement === undefined
		? Command.expectNone()
		: Command.resolve(announcement, Calendar.Message.CompletedAnnounce())
}

describe("date picker story", () => {
	test("pressing the trigger opens the calendar on today when no date is set", () => {
		story(
			update,
			given(empty),
			message(Message.ClickedTrigger()),
			Command.expectNone(),
			expectNoOutMessage(),
			model((next) => {
				expect(next.isOpen).toBe(true)
				expect(next.calendar.focusedDate).toBe(today)
				expect(next.calendar.value).toEqual(Option.none())
			}),
		)
	})

	test("pressing the trigger opens the calendar on the current value, and pressing it again closes", () => {
		story(
			update,
			given(withValue),
			message(Message.ClickedTrigger()),
			model((next) => {
				expect(next.isOpen).toBe(true)
				expect(next.calendar.focusedDate).toBe("2026-03-18")
			}),
			message(Message.ClickedTrigger()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("Escape, a press outside and the hidden dismiss button each close without changing the value", () => {
		const closesWith = (dismiss: Message) =>
			story(
				update,
				given(withValue),
				message(Message.ClickedTrigger()),
				message(dismiss),
				Command.expectNone(),
				expectNoOutMessage(),
				model((next) => {
					expect(next.isOpen).toBe(false)
					expect(next.segments.committed).toBe("2026-03-18")
				}),
			)
		closesWith(Message.PressedEscape())
		closesWith(Message.PressedOutside())
		closesWith(Message.ClickedDismiss())
	})

	test("picking a day commits it to the segments, closes the popover and reports the date", () => {
		story(
			update,
			given(empty),
			message(Message.ClickedTrigger()),
			calendar(Calendar.Message.ClickedCell({ date: "2026-03-20" })),
			expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-20" })),
			resolveSelectionAnnouncement("2026-03-20"),
			model((next) => {
				expect(next.isOpen).toBe(false)
				expect(next.segments.committed).toBe("2026-03-20")
				expect([
					next.segments.values.year,
					next.segments.values.month,
					next.segments.values.day,
				]).toEqual([2026, 3, 20])
				expect(next.calendar.value).toEqual(Option.some("2026-03-20"))
			}),
		)
	})

	test("Enter in the calendar commits the focused day", () => {
		story(
			update,
			given(empty),
			message(Message.ClickedTrigger()),
			calendar(Calendar.Message.PressedGridKey({ key: "Enter" })),
			expectOutMessage(OutMessage.ChangedValue({ date: today })),
			resolveSelectionAnnouncement(today),
			model((next) => {
				expect(next.isOpen).toBe(false)
				expect(next.segments.committed).toBe(today)
			}),
		)
	})

	test("a day before the minimum stays unselectable and keeps the popover open", () => {
		story(
			update,
			given(init({ id: "due", today, minValue: "2026-03-10" })),
			message(Message.ClickedTrigger()),
			calendar(Calendar.Message.ClickedCell({ date: "2026-03-05" })),
			Command.expectNone(),
			expectNoOutMessage(),
			model((next) => {
				expect(next.isOpen).toBe(true)
				expect(next.segments.committed).toBeNull()
			}),
		)
	})

	test("typing a date into the segments moves focus between segments and shows that date on open", () => {
		story(
			update,
			given(empty),
			segmentKey("month", "4"),
			Command.expectExact(Segments.FocusSegment({ elementId: "due-input-day" })),
			focused,
			segmentKey("day", "9"),
			Command.expectExact(Segments.FocusSegment({ elementId: "due-input-year" })),
			focused,
			segmentKey("year", "2"),
			announced,
			segmentKey("year", "0"),
			announced,
			segmentKey("year", "2"),
			announced,
			segmentKey("year", "7"),
			announced,
			model((next) => {
				expect(next.segments.committed).toBe("2027-04-09")
				expect(next.segments.pendingFocusMoves).toBe(0)
			}),
			message(Message.ClickedTrigger()),
			model((next) => {
				expect(next.calendar.focusedDate).toBe("2027-04-09")
				expect(next.calendar.value).toEqual(Option.some("2027-04-09"))
			}),
		)
	})

	// Bug: completing a date by typing in the segments never emits OutMessage.ChangedValue (date-picker.ts:138).
	test.fails("typing a complete date into the segments reports the new value to the parent", () => {
		story(
			update,
			given(withValue),
			segmentKey("day", "2"),
			announced,
			segmentKey("day", "5"),
			model((next) => expect(next.segments.committed).toBe("2026-03-25")),
			expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-25" })),
			Command.resolveAll(
				[Segments.FocusSegment, Segments.Message.CompletedFocusSegment()],
				[Segments.AnnounceValue, Segments.Message.CompletedAnnounceValue()],
			),
		)
	})

	test("the portal mount completing leaves the picker unchanged", () => {
		story(
			update,
			given(withValue),
			message(Message.ClickedTrigger()),
			message(Message.CompletedPortalPicker()),
			Command.expectNone(),
			expectNoOutMessage(),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})
})
