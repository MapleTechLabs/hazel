import { Option } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { init, Message, update } from "./toggle-group"

/** React Aria ToggleButtonGroup: single and multiple selection plus hover, focus and modality. */

const alignment = init({ label: "Alignment", selectedKeys: ["center"] })
const formatting = init({ label: "Formatting", selectionMode: "multiple", selectedKeys: ["bold"] })
const click = (key: string) => message(Message.ClickedItem({ key }))

describe("toggle-group story", () => {
	test("clicking an item in a single group replaces the selection", () => {
		story(
			update,
			given(alignment),
			click("left"),
			Command.expectNone(),
			model((next) => expect(next.selectedKeys).toEqual(["left"])),
		)
	})

	test("clicking the selected item in a single group clears the selection", () => {
		story(
			update,
			given(alignment),
			click("center"),
			model((next) => expect(next.selectedKeys).toEqual([])),
		)
	})

	test("items in a multiple group toggle independently", () => {
		story(
			update,
			given(formatting),
			click("italic"),
			model((next) => expect(next.selectedKeys).toEqual(["bold", "italic"])),
			click("bold"),
			model((next) => expect(next.selectedKeys).toEqual(["italic"])),
		)
	})

	test("pointer presses switch to pointer modality and arrow keys back to keyboard", () => {
		story(
			update,
			given(alignment),
			message(Message.PressedPointer()),
			model((next) => expect(next.interaction.modality).toBe("Pointer")),
			message(Message.PressedNavigationKey()),
			model((next) => expect(next.interaction.modality).toBe("Keyboard")),
			message(Message.PressedPointer()),
			message(Message.ReleasedKey()),
			model((next) => expect(next.interaction.modality).toBe("Keyboard")),
		)
	})

	test("unhovering a different item keeps the current hover", () => {
		story(
			update,
			given(alignment),
			message(Message.HoveredItem({ key: "right" })),
			message(Message.UnhoveredItem({ key: "left" })),
			model((next) => expect(next.interaction.maybeHoveredKey).toEqual(Option.some("right"))),
			message(Message.UnhoveredItem({ key: "right" })),
			model((next) => expect(next.interaction.maybeHoveredKey).toEqual(Option.none())),
		)
	})

	test("focus follows the focused item and clears on its blur", () => {
		story(
			update,
			given(alignment),
			message(Message.FocusedItem({ key: "left" })),
			model((next) => expect(next.interaction.maybeFocusedKey).toEqual(Option.some("left"))),
			message(Message.BlurredItem({ key: "left" })),
			model((next) => expect(next.interaction.maybeFocusedKey).toEqual(Option.none())),
		)
	})
})
