import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { FocusToolbarItem, init, Message, update } from "./toolbar"

/** React Aria Toolbar: arrow keys only ask a Command to move DOM focus; the Model never changes. */

const toolbar = init({ label: "Text formatting" })

describe("toolbar story", () => {
	test("toolbars are horizontal unless told otherwise", () => {
		expect(toolbar.orientation).toBe("horizontal")
		expect(init({ label: "Tools", orientation: "vertical" }).orientation).toBe("vertical")
	})

	test("Next moves focus to the following item in this toolbar", () => {
		story(
			update,
			given(toolbar),
			message(Message.PressedNavigationKey({ direction: "Next" })),
			Command.expectExact(FocusToolbarItem({ label: "Text formatting", direction: "Next" })),
			Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
			model((next) => expect(next).toEqual(toolbar)),
		)
	})

	test("Previous moves focus to the preceding item in this toolbar", () => {
		story(
			update,
			given(toolbar),
			message(Message.PressedNavigationKey({ direction: "Previous" })),
			Command.expectExact(FocusToolbarItem({ label: "Text formatting", direction: "Previous" })),
			Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
		)
	})

	test("every press dispatches its own focus move so quick presses are not merged", () => {
		story(
			update,
			given(toolbar),
			message(Message.PressedNavigationKey({ direction: "Next" })),
			Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
			message(Message.PressedNavigationKey({ direction: "Next" })),
			Command.expectExact(FocusToolbarItem({ label: "Text formatting", direction: "Next" })),
			Command.resolve(FocusToolbarItem, Message.CompletedFocusToolbarItem()),
		)
	})
})
