// @vitest-environment jsdom
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { close, init, Message, open, update } from "./modal"

/** React Aria DialogTrigger + Modal: the trigger opens, close, Escape and outside presses dismiss. */

const closedModal = init("rename")
const openModal = { ...closedModal, isOpen: true }

describe("modal story", () => {
	test("a new modal starts closed", () => {
		story(
			update,
			given(closedModal),
			model((next) => expect(next).toEqual({ id: "rename", isOpen: false })),
		)
	})

	test("pressing the trigger opens the modal and runs no Commands", () => {
		story(
			update,
			given(closedModal),
			message(Message.ClickedTrigger()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("pressing the trigger again keeps an open modal open", () => {
		story(
			update,
			given(openModal),
			message(Message.ClickedTrigger()),
			model((next) => expect(next.isOpen).toBe(true)),
		)
	})

	test("the close button closes the modal", () => {
		story(
			update,
			given(openModal),
			message(Message.ClickedClose()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("Escape closes the modal", () => {
		story(
			update,
			given(openModal),
			message(Message.PressedEscape()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("a press outside the modal closes it", () => {
		story(
			update,
			given(openModal),
			message(Message.PressedOutside()),
			Command.expectNone(),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("the portal finishing its mount leaves the modal as it was", () => {
		story(
			update,
			given(openModal),
			message(Message.CompletedPortalModal()),
			model((next) => expect(next).toEqual(openModal)),
		)
	})

	test("a parent can open and close the modal without a Message", () => {
		expect(open(closedModal).model.isOpen).toBe(true)
		expect(close(openModal).model.isOpen).toBe(false)
		expect(open(closedModal).commands).toBeUndefined()
	})
})
