import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	entry,
	FocusListBoxItem,
	init,
	item,
	Message,
	OutMessage,
	update,
	WaitForListBoxTypeaheadReset,
} from "./list-box"

/** React Aria ListBox: roving focus without wrapping, typeahead, and toggle selection. */

const themes = init({
	id: "theme",
	entries: [
		entry(item("light", "Light")),
		entry(item("dark", "Dark", { isDisabled: true })),
		entry(item("dim", "Dim")),
		entry(item("system", "System")),
	],
	selectionMode: "single",
	selectedKeys: ["system"],
})
const focusedOn = (key: string) => ({ ...themes, focusedKey: Option.some(key), isFocusWithin: true })
const press = (key: string, isModified = false) => message(Message.PressedKey({ key, isModified }))
const focusOf = (key: string) => FocusListBoxItem({ elementId: `theme-listbox-option-${key}` })

describe("list-box story", () => {
	test("tabbing into the list focuses the selected option", () => {
		story(
			update,
			given(themes),
			message(Message.FocusedList({ isFromAfter: false })),
			Command.expectExact(focusOf("system")),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => {
				expect(next.focusedKey).toEqual(Option.some("system"))
				expect(next.isFocusWithin).toBe(true)
			}),
		)
	})

	test("ArrowDown skips the disabled option", () => {
		story(
			update,
			given(focusedOn("light")),
			press("ArrowDown"),
			Command.expectExact(focusOf("dim")),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => {
				expect(next.focusedKey).toEqual(Option.some("dim"))
				expect(next.modality).toBe("Keyboard")
			}),
		)
	})

	test("ArrowUp on the first option stays put instead of wrapping", () => {
		story(
			update,
			given(focusedOn("light")),
			press("ArrowUp"),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.focusedKey).toEqual(Option.some("light"))),
		)
	})

	test("Home and End jump to the first and last enabled option", () => {
		story(
			update,
			given(focusedOn("dim")),
			press("End"),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.focusedKey).toEqual(Option.some("system"))),
			press("Home"),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.focusedKey).toEqual(Option.some("light"))),
		)
	})

	test("Enter selects the focused option and reports the new selection", () => {
		story(
			update,
			given(focusedOn("dim")),
			press("Enter"),
			Command.expectNone(),
			expectOutMessage(OutMessage.ChangedSelection({ keys: ["dim"] })),
			model((next) => {
				expect(next.selectedKeys).toEqual(["dim"])
				expect(next.pressedKey).toEqual(Option.some("dim"))
			}),
			message(Message.ReleasedKey({ key: "Enter" })),
			model((next) => expect(next.pressedKey).toEqual(Option.none())),
		)
	})

	test("pressing the selected option again deselects it in single mode", () => {
		story(
			update,
			given(themes),
			message(Message.PressedItem({ key: "system", button: 0 })),
			Command.expectExact(focusOf("system")),
			expectOutMessage(OutMessage.ChangedSelection({ keys: [] })),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.modality).toBe("Pointer")),
		)
	})

	test("multiple selection adds and removes keys independently", () => {
		story(
			update,
			given(init({ ...themes, selectionMode: "multiple", selectedKeys: ["light"] })),
			message(Message.PressedItem({ key: "dim", button: 0 })),
			expectOutMessage(OutMessage.ChangedSelection({ keys: ["light", "dim"] })),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			message(Message.PressedItem({ key: "light", button: 0 })),
			expectOutMessage(OutMessage.ChangedSelection({ keys: ["dim"] })),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
		)
	})

	test("disabled options and secondary buttons never select", () => {
		story(
			update,
			given(themes),
			message(Message.PressedItem({ key: "dark", button: 0 })),
			Command.expectNone(),
			expectNoOutMessage(),
			message(Message.PressedItem({ key: "light", button: 2 })),
			Command.expectNone(),
			expectNoOutMessage(),
			model((next) => expect(next.selectedKeys).toEqual(["system"])),
		)
	})

	test("typeahead focuses the next match and clears the search after a pause", () => {
		story(
			update,
			given(focusedOn("light")),
			press("s"),
			Command.expectExact(focusOf("system"), WaitForListBoxTypeaheadReset({ search: "s" })),
			Command.resolve(FocusListBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.search).toBe("s")),
			Command.resolve(
				WaitForListBoxTypeaheadReset,
				Message.CompletedWaitForTypeaheadReset({ search: "s" }),
			),
			model((next) => expect(next.search).toBe("")),
		)
	})

	test("a stale typeahead timer does not clear a longer search", () => {
		story(
			update,
			given({ ...focusedOn("dim"), search: "di" }),
			message(Message.CompletedWaitForTypeaheadReset({ search: "d" })),
			model((next) => expect(next.search).toBe("di")),
		)
	})

	test("Space during an active search types into it instead of selecting", () => {
		story(
			update,
			given({ ...focusedOn("dim"), search: "d" }),
			press(" "),
			Command.expectExact(WaitForListBoxTypeaheadReset({ search: "d " })),
			expectNoOutMessage(),
			model((next) => expect(next.search).toBe("d ")),
			Command.resolve(
				WaitForListBoxTypeaheadReset,
				Message.CompletedWaitForTypeaheadReset({ search: "d " }),
			),
			model((next) => expect(next.search).toBe("")),
		)
	})

	test("letters typed with a modifier do not start a search", () => {
		story(
			update,
			given(focusedOn("dim")),
			press("a", true),
			Command.expectNone(),
			model((next) => expect(next.search).toBe("")),
		)
	})
})
