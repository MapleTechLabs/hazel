// @vitest-environment jsdom
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { FocusButton, init, Message, OutMessage, update } from "./popover"

/** Popover on @foldkit/ui Popover: open and close, focus back to the trigger on close. */

const closedPopover = init("details")
const openPopover = { ...closedPopover, isOpen: true }

describe("popover story", () => {
	test("a new popover starts closed and hands focus to its content", () => {
		expect(closedPopover.isOpen).toBe(false)
		expect(closedPopover.contentFocus).toBe(true)
	})

	test("a request to open opens it and emits Opened", () => {
		story(
			update,
			given(closedPopover),
			message(Message.RequestedOpen()),
			expectOutMessage(OutMessage.Opened()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("a request to close closes it, focuses the trigger and emits Closed", () => {
		story(
			update,
			given(openPopover),
			message(Message.RequestedClose()),
			expectOutMessage(OutMessage.Closed()),
			Command.resolve(FocusButton, Message.CompletedFocusButton()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})
})
