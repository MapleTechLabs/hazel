import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { FocusTab, init, Message, update } from "./tabs"

/** React Aria Tabs with automatic activation: arrows select and focus, wrapping past disabled tabs. */

const keys = ["general", "members", "billing", "danger"]
const tabs = init({ id: "settings", selectedKey: "general" })
const navigate = (direction: "Next" | "Previous" | "First" | "Last", disabledKeys: ReadonlyArray<string> = []) =>
	message(Message.PressedNavigationKey({ direction, keys, disabledKeys }))

describe("tabs story", () => {
	test("ArrowRight selects the next tab and moves focus to it", () => {
		story(
			update,
			given(tabs),
			navigate("Next"),
			Command.expectExact(FocusTab({ elementId: "settings-tab-members" })),
			Command.resolve(FocusTab, Message.CompletedFocusTab()),
			model((next) => {
				expect(next.selectedKey).toBe("members")
				expect(next.interaction.modality).toBe("Keyboard")
			}),
		)
	})

	test("navigation skips disabled tabs", () => {
		story(
			update,
			given(tabs),
			navigate("Next", ["members"]),
			Command.expectExact(FocusTab({ elementId: "settings-tab-billing" })),
			Command.resolve(FocusTab, Message.CompletedFocusTab()),
			model((next) => expect(next.selectedKey).toBe("billing")),
		)
	})

	test("Previous from the first tab wraps to the last", () => {
		story(
			update,
			given(tabs),
			navigate("Previous"),
			Command.resolve(FocusTab, Message.CompletedFocusTab()),
			model((next) => expect(next.selectedKey).toBe("danger")),
		)
	})

	test("Home and End jump to the first and last enabled tab", () => {
		story(
			update,
			given(init({ id: "settings", selectedKey: "billing" })),
			navigate("First", ["general"]),
			Command.resolve(FocusTab, Message.CompletedFocusTab()),
			model((next) => expect(next.selectedKey).toBe("members")),
			navigate("Last", ["danger"]),
			Command.resolve(FocusTab, Message.CompletedFocusTab()),
			model((next) => expect(next.selectedKey).toBe("billing")),
		)
	})

	test("navigation with every other tab disabled keeps the selection and moves no focus", () => {
		story(
			update,
			given(tabs),
			navigate("Next", ["general", "members", "billing", "danger"]),
			Command.expectNone(),
			model((next) => expect(next.selectedKey).toBe("general")),
		)
	})

	test("a pointer press selects the tab and switches to pointer modality", () => {
		story(
			update,
			given(tabs),
			message(Message.PressedTab({ key: "billing" })),
			Command.expectNone(),
			model((next) => {
				expect(next.selectedKey).toBe("billing")
				expect(next.interaction.modality).toBe("Pointer")
			}),
		)
	})

	test("hover and focus track one key each and clear only their own key", () => {
		story(
			update,
			given(tabs),
			message(Message.HoveredTab({ key: "members" })),
			message(Message.FocusedTab({ key: "general" })),
			message(Message.UnhoveredTab({ key: "general" })),
			model((next) => {
				expect(next.interaction.maybeHoveredKey).toEqual(expect.objectContaining({ value: "members" }))
				expect(next.interaction.maybeFocusedKey).toEqual(expect.objectContaining({ value: "general" }))
			}),
			message(Message.BlurredTab({ key: "general" })),
			model((next) => expect(next.interaction.maybeFocusedKey._tag).toBe("None")),
		)
	})

	test("focusing the panel marks it focused until it blurs", () => {
		story(
			update,
			given(tabs),
			message(Message.FocusedPanel()),
			model((next) => expect(next.panelFocus).toBe("Focused")),
			message(Message.BlurredPanel()),
			model((next) => expect(next.panelFocus).toBe("Unfocused")),
		)
	})
})
