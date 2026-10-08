import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	close,
	init,
	item,
	Message,
	OutMessage,
	open,
	section,
	update,
	visibleSections,
} from "./command-menu"

/** Autocomplete + Menu: filtering, virtual focus that wraps, activation and dismissal OutMessages. */

const palette = init({
	id: "palette",
	sections: [
		section("Recent", [item("general", "general"), item("design", "design", true)]),
		section("Quick Actions", [item("create", "create channel"), item("cafe", "Café settings")]),
	],
})
const opened = open(palette).model
const press = (key: string) => message(Message.PressedSearchKey({ key }))
const type = (value: string) => message(Message.ChangedSearch({ value }))
const focusedKey = (key: string) =>
	model<typeof palette>((next) => expect(next.focusedKey).toEqual(Option.some(key)))

describe("command menu story: search and navigation", () => {
	test("opening from the parent shows an empty search with nothing focused", () => {
		const dirty = { ...palette, inputValue: "gen", focusedKey: Option.some("general") }
		const next = open(dirty)
		expect(next.model).toMatchObject({ isOpen: true, inputValue: "" })
		expect(Option.isNone(next.model.focusedKey)).toBe(true)
		expect(next.commands).toBeUndefined()
	})

	test("typing filters items ignoring case and accents, and focuses the first match", () => {
		story(
			update,
			given(opened),
			type("CAFE"),
			Command.expectNone(),
			expectNoOutMessage(),
			model((next) => {
				expect(
					visibleSections(next).flatMap((entry) => entry.items.map((candidate) => candidate.key)),
				).toEqual(["cafe"])
				expect(next.modality).toBe("Pointer")
			}),
			focusedKey("cafe"),
		)
	})

	test("sections with no matching item are hidden", () => {
		story(
			update,
			given(opened),
			type("create"),
			model((next) =>
				expect(visibleSections(next).map((entry) => entry.label)).toEqual([
					Option.some("Quick Actions"),
				]),
			),
		)
	})

	test("clearing the search clears the focused item", () => {
		story(
			update,
			given(opened),
			type("des"),
			focusedKey("design"),
			type(""),
			model((next) => expect(Option.isNone(next.focusedKey)).toBe(true)),
		)
	})

	test("ArrowDown moves virtual focus through every section and wraps to the first item", () => {
		story(
			update,
			given(opened),
			press("ArrowDown"),
			focusedKey("general"),
			model((next) => expect(next.modality).toBe("Keyboard")),
			press("ArrowDown"),
			press("ArrowDown"),
			focusedKey("create"),
			press("ArrowDown"),
			press("ArrowDown"),
			focusedKey("general"),
		)
	})

	test("ArrowUp with nothing focused starts at the last item and wraps upwards", () => {
		story(
			update,
			given(opened),
			press("ArrowUp"),
			focusedKey("cafe"),
			press("ArrowUp"),
			focusedKey("create"),
		)
	})

	test("arrow keys only visit items that match the search", () => {
		story(update, given(opened), type("e"), focusedKey("general"), press("ArrowUp"), focusedKey("cafe"))
	})

	test("hovering an item focuses it with pointer modality, and leaving clears only that hover", () => {
		story(
			update,
			given(opened),
			press("ArrowDown"),
			message(Message.HoveredItem({ key: "create" })),
			focusedKey("create"),
			model((next) => expect(next.modality).toBe("Pointer")),
			message(Message.UnhoveredItem({ key: "general" })),
			model((next) => expect(next.hoveredKey).toEqual(Option.some("create"))),
			message(Message.UnhoveredItem({ key: "create" })),
			model((next) => expect(Option.isNone(next.hoveredKey)).toBe(true)),
			focusedKey("create"),
		)
	})
})

describe("command menu story: activation and dismissal", () => {
	test("Enter activates the focused item, closes and resets the menu", () => {
		story(
			update,
			given(opened),
			type("des"),
			press("Enter"),
			expectOutMessage(OutMessage.SelectedItem({ key: "design" })),
			model((next) => expect(next).toMatchObject({ isOpen: false, inputValue: "" })),
		)
	})

	test("Enter with nothing focused does nothing", () => {
		story(
			update,
			given(opened),
			press("Enter"),
			expectNoOutMessage(),
			model((next) => expect(next).toEqual(opened)),
		)
	})

	test("clicking an item selects it", () => {
		story(
			update,
			given(opened),
			message(Message.ClickedItem({ key: "create" })),
			expectOutMessage(OutMessage.SelectedItem({ key: "create" })),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("Escape clears a typed search first and keeps the menu open", () => {
		story(
			update,
			given(opened),
			type("gen"),
			press("Escape"),
			expectNoOutMessage(),
			model((next) => {
				expect(next).toMatchObject({ isOpen: true, inputValue: "" })
				expect(Option.isNone(next.focusedKey)).toBe(true)
			}),
		)
	})

	test("Escape on an empty search closes the menu and tells the parent", () => {
		story(
			update,
			given(opened),
			press("Escape"),
			expectOutMessage(OutMessage.Closed()),
			model((next) => expect(next.isOpen).toBe(false)),
		)
	})

	test("the Esc button, an outside press and the hidden dismiss button all close the menu", () => {
		const closesWith = (closing: Message) =>
			story(
				update,
				given(opened),
				type("gen"),
				message(closing),
				expectOutMessage(OutMessage.Closed()),
				model((next) => expect(next).toMatchObject({ isOpen: false, inputValue: "" })),
			)
		closesWith(Message.ClickedEscapeButton())
		closesWith(Message.PressedOutside())
		closesWith(Message.ClickedDismiss())
	})

	test("other keys in the search leave the menu unchanged", () => {
		story(
			update,
			given(opened),
			press("Tab"),
			expectNoOutMessage(),
			model((next) => expect(next).toEqual(opened)),
		)
	})

	test("closing from the parent resets the search", () => {
		const next = close({ ...opened, inputValue: "gen", focusedKey: Option.some("general") })
		expect(next.model).toMatchObject({ isOpen: false, inputValue: "" })
		expect(Option.isNone(next.model.focusedKey)).toBe(true)
	})
})
