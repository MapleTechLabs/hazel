// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { init, Message, update } from "./popover"

/** React Aria DialogTrigger + Popover: the trigger toggles, close, Escape and outside presses dismiss. */

const closedPopover = init("details")
const openPopover = { ...closedPopover, isOpen: true }

describe("popover story", () => {
	test("a new popover starts closed", () => {
		story(
			update,
			given(closedPopover),
			model((next) => expect(next).toEqual({ id: "details", isOpen: false })),
		)
	})

	test("pressing the trigger opens the popover", () => {
		story(
			update,
			given(closedPopover),
			message(Message.ClickedTrigger()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("pressing the trigger of an open popover closes it", () => {
		story(
			update,
			given(openPopover),
			message(Message.ClickedTrigger()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("a close button closes the popover", () => {
		story(
			update,
			given(openPopover),
			message(Message.ClickedClose()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("Escape closes the popover", () => {
		story(
			update,
			given(openPopover),
			message(Message.PressedEscape()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("a press outside closes the popover", () => {
		story(
			update,
			given(openPopover),
			message(Message.PressedOutside()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("dismissing an already closed popover keeps it closed", () => {
		story(
			update,
			given(closedPopover),
			message(Message.PressedOutside()),
			message(Message.PressedEscape()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("the portal finishing its mount leaves the popover as it was", () => {
		story(
			update,
			given(openPopover),
			message(Message.CompletedPortalPopover()),
			Command.expectNone(),
			model((next) => expect(next).toEqual(openPopover)),
		)
	})
})
