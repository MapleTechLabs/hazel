// @vitest-environment jsdom
// Interaction.subscriptions reads `document` at import time, so the Story needs a DOM environment.
import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import * as Interaction from "./aria/interaction"
import { Announce, FocusCell, highlightedRange, init, Message, OutMessage, update } from "./calendar"
import * as Select from "./select"

/** Calendar and RangeCalendar update: grid keys, paging, minimum date, selection and announcements. */

// March 2026 starts on a Sunday; the 18th is a Wednesday. Every date is fixed, nothing reads the clock.
const today = "2026-03-05"
const event = init({ id: "event", today, value: "2026-03-18" })
const deadline = init({ id: "deadline", today, minValue: "2026-03-10" })
const trip = init({ id: "trip", mode: "Range", today, range: { start: "2026-03-09", end: "2026-03-13" } })

const key = (pressed: string) => message(Message.PressedGridKey({ key: pressed }))
const focusCell = (label: string, grid = "event-grid") => FocusCell({ gridId: grid, label })
const resolveFocus = Command.resolve(FocusCell, Message.CompletedFocusCell())
const resolveAnnounce = Command.resolve(Announce, Message.CompletedAnnounce())

describe("calendar story: keyboard navigation", () => {
	test("ArrowRight and ArrowLeft move focus one day and focus that cell", () => {
		story(
			update,
			given(event),
			key("ArrowRight"),
			Command.expectExact(focusCell("Thursday, March 19, 2026")),
			resolveFocus,
			model((next) => expect(next.focusedDate).toBe("2026-03-19")),
			key("ArrowLeft"),
			resolveFocus,
			key("ArrowLeft"),
			resolveFocus,
			model((next) => expect(next.focusedDate).toBe("2026-03-17")),
			expectNoOutMessage(),
		)
	})

	test("ArrowDown and ArrowUp move focus one week", () => {
		story(
			update,
			given(event),
			key("ArrowDown"),
			Command.expectExact(focusCell("Wednesday, March 25, 2026")),
			resolveFocus,
			key("ArrowUp"),
			resolveFocus,
			key("ArrowUp"),
			resolveFocus,
			model((next) => expect(next.focusedDate).toBe("2026-03-11")),
		)
	})

	test("Home and End jump to the start and end of the week", () => {
		story(
			update,
			given(event),
			key("Home"),
			Command.expectExact(focusCell("Sunday, March 15, 2026")),
			resolveFocus,
			key("End"),
			Command.expectExact(focusCell("Saturday, March 21, 2026")),
			resolveFocus,
			model((next) => expect(next.focusedDate).toBe("2026-03-21")),
		)
	})

	test("arrowing past the last day shows the next month without announcing it", () => {
		story(
			update,
			given(init({ id: "event", today, value: "2026-03-31" })),
			key("ArrowRight"),
			Command.expectExact(focusCell("Wednesday, April 1, 2026")),
			resolveFocus,
			model((next) => {
				expect(next.focusedDate).toBe("2026-04-01")
				expect(next.month.selectedKey).toEqual(Option.some("4"))
			}),
		)
	})

	test("PageDown and PageUp move a month, clamping the day to the shorter month", () => {
		story(
			update,
			given(init({ id: "event", today, value: "2026-01-31" })),
			key("PageDown"),
			Command.expectExact(focusCell("Saturday, February 28, 2026")),
			resolveFocus,
			key("PageUp"),
			Command.expectExact(focusCell("Wednesday, January 28, 2026")),
			resolveFocus,
			model((next) => expect(next.focusedDate).toBe("2026-01-28")),
		)
	})

	test("a key the grid does not handle changes nothing", () => {
		story(
			update,
			given(event),
			key("a"),
			Command.expectNone(),
			model((next) => expect(next).toEqual(event)),
		)
	})
})

describe("calendar story: minimum date", () => {
	test("keyboard focus stops at the first available date", () => {
		story(
			update,
			given(init({ id: "deadline", today, value: "2026-03-12", minValue: "2026-03-10" })),
			key("ArrowUp"),
			Command.expectExact(focusCell("Tuesday, March 10, 2026", "deadline-grid")),
			resolveFocus,
			model((next) => expect(next.focusedDate).toBe("2026-03-10")),
		)
	})

	test("clicking a day before the minimum or outside the month selects nothing", () => {
		story(
			update,
			given(deadline),
			message(Message.ClickedCell({ date: "2026-03-09" })),
			Command.expectNone(),
			expectNoOutMessage(),
			message(Message.ClickedCell({ date: "2026-04-02" })),
			Command.expectNone(),
			expectNoOutMessage(),
			model((next) => expect(next.value).toEqual(Option.none())),
		)
	})

	// T8: paging clamps the focused date to minValue, as React Aria constrains focusedDate.
	test("paging back into the minimum month keeps focus on the first available date", () => {
		story(
			update,
			given(init({ id: "deadline", today, value: "2026-04-05", minValue: "2026-03-10" })),
			message(Message.ClickedPrevious()),
			resolveAnnounce,
			model((next) => expect(next.focusedDate).toBe("2026-03-10")),
		)
	})

	test("a calendar whose value precedes minValue starts focused on the minimum", () => {
		const early = init({ id: "deadline", today, value: "2026-03-02", minValue: "2026-03-10" })
		expect(early.focusedDate).toBe("2026-03-10")
	})
})

describe("calendar story: single selection", () => {
	test("clicking a day selects it, tells the parent and announces the selection politely", () => {
		story(
			update,
			given(event),
			message(Message.ClickedCell({ date: "2026-03-20" })),
			expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-20" })),
			Command.expectExact(
				Announce({
					message: "Selected Date: Friday, March 20, 2026",
					timeout: 4000,
					assertiveness: "polite",
				}),
			),
			resolveAnnounce,
			model((next) => {
				expect(next.value).toEqual(Option.some("2026-03-20"))
				expect(next.focusedDate).toBe("2026-03-20")
			}),
		)
	})

	test("Enter selects the focused day", () => {
		story(
			update,
			given(event),
			key("ArrowRight"),
			resolveFocus,
			key("Enter"),
			expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-19" })),
			resolveAnnounce,
		)
	})

	test("clicking the already selected day emits the value again without a new announcement", () => {
		story(
			update,
			given(event),
			message(Message.ClickedCell({ date: "2026-03-18" })),
			expectOutMessage(OutMessage.ChangedValue({ date: "2026-03-18" })),
			Command.expectNone(),
		)
	})

	test("the Next and Previous buttons page a month and announce it assertively", () => {
		story(
			update,
			given(event),
			message(Message.ClickedNext()),
			Command.expectExact(
				Announce({ message: "April 2026", timeout: 7000, assertiveness: "assertive" }),
			),
			resolveAnnounce,
			message(Message.ClickedPrevious()),
			resolveAnnounce,
			message(Message.ClickedPrevious()),
			Command.expectExact(
				Announce({ message: "February 2026", timeout: 7000, assertiveness: "assertive" }),
			),
			resolveAnnounce,
			model((next) => {
				expect(next.focusedDate).toBe("2026-02-18")
				expect(next.value).toEqual(Option.some("2026-03-18"))
			}),
			expectNoOutMessage(),
		)
	})

	test("ArrowRight on the year picker moves to the same day next year and announces the month", () => {
		story(
			update,
			given(event),
			message(
				Message.GotYearMessage({ message: Select.Message.PressedTriggerKey({ key: "ArrowRight" }) }),
			),
			Command.expectExact(
				Announce({ message: "March 2027", timeout: 7000, assertiveness: "assertive" }),
			),
			resolveAnnounce,
			model((next) => {
				expect(next.focusedDate).toBe("2027-03-18")
				expect(next.year.selectedKey).toEqual(Option.some("20"))
			}),
		)
	})
})

describe("range calendar story", () => {
	test("the first click starts a range without telling the parent or announcing", () => {
		story(
			update,
			given(trip),
			message(Message.ClickedCell({ date: "2026-03-16" })),
			expectNoOutMessage(),
			Command.expectNone(),
			model((next) => {
				expect(next.anchor).toEqual(Option.some("2026-03-16"))
				expect(highlightedRange(next)).toEqual(
					Option.some({ start: "2026-03-16", end: "2026-03-16" }),
				)
			}),
		)
	})

	test("hovering a day previews the range from the anchor, in date order", () => {
		story(
			update,
			given(trip),
			message(Message.ClickedCell({ date: "2026-03-16" })),
			message(
				Message.GotInteractionMessage({
					message: Interaction.Message.EnteredTarget({ target: "cell-2026-03-11" }),
				}),
			),
			model((next) =>
				expect(highlightedRange(next)).toEqual(
					Option.some({ start: "2026-03-11", end: "2026-03-16" }),
				),
			),
			message(
				Message.GotInteractionMessage({
					message: Interaction.Message.LeftTarget({ target: "cell-2026-03-11" }),
				}),
			),
			model((next) =>
				expect(highlightedRange(next)).toEqual(
					Option.some({ start: "2026-03-16", end: "2026-03-16" }),
				),
			),
		)
	})

	test("the second click completes the range, emits it and announces it", () => {
		story(
			update,
			given(trip),
			message(Message.ClickedCell({ date: "2026-03-20" })),
			message(Message.ClickedCell({ date: "2026-03-17" })),
			expectOutMessage(OutMessage.ChangedRange({ start: "2026-03-17", end: "2026-03-20" })),
			Command.expectExact(
				Announce({
					message: "Selected Range: Tuesday, March 17 to Friday, March 20, 2026",
					timeout: 4000,
					assertiveness: "polite",
				}),
			),
			resolveAnnounce,
			model((next) => {
				expect(next.anchor).toEqual(Option.none())
				expect(next.range).toEqual(Option.some({ start: "2026-03-17", end: "2026-03-20" }))
			}),
		)
	})

	test("a range of one day is announced as a single date", () => {
		story(
			update,
			given(trip),
			key("Enter"),
			key("Enter"),
			expectOutMessage(OutMessage.ChangedRange({ start: "2026-03-09", end: "2026-03-09" })),
			Command.expectExact(
				Announce({
					message: "Selected Date: Monday, March 9, 2026",
					timeout: 4000,
					assertiveness: "polite",
				}),
			),
			resolveAnnounce,
		)
	})

	test("arrowing after the first click extends the preview to the focused day", () => {
		story(
			update,
			given(trip),
			key("Enter"),
			key("ArrowDown"),
			Command.expectExact(focusCell("Monday, March 16, 2026", "trip-grid")),
			resolveFocus,
			model((next) =>
				expect(highlightedRange(next)).toEqual(
					Option.some({ start: "2026-03-09", end: "2026-03-16" }),
				),
			),
		)
	})
})
