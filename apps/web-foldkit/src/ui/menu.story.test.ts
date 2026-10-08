import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	FocusElement,
	init,
	item,
	leaf,
	Message,
	type Model,
	OutMessage,
	update,
	WaitForTypeaheadReset,
} from "./menu"

/** React Aria Menu: open strategies, wrapping navigation, typeahead, submenus and activation. */

const entries = [
	item("new", { textValue: "New" }),
	item("open", { textValue: "Open" }),
	item("archive", { textValue: "Archive", isDisabled: true }),
	item("share", {
		textValue: "Share",
		submenu: [leaf("email"), leaf("link", { isDisabled: true }), leaf("slack")],
	}),
	item("docs", { textValue: "Docs", href: "/docs" }),
]
const menu = init({ id: "file", entries })
const pressMenuKey = (key: string, isModified = false) => message(Message.PressedMenuKey({ key, isModified }))
const focusOf = (next: Model) => (next.popup._tag === "Open" ? next.popup.focusedKey : Option.none())
const submenuOf = (next: Model) => (next.popup._tag === "Open" ? next.popup.submenu : Option.none())
const searchOf = (next: Model) => (next.popup._tag === "Open" ? next.popup.search : "")
const searching = (search: string, focusedKey: string): Model => ({
	...menu,
	popup: {
		_tag: "Open",
		focusedKey: Option.some(focusedKey),
		hoveredKey: Option.none(),
		modality: "Keyboard",
		submenu: Option.none(),
		search,
		pointerOffset: Option.none(),
	},
})
const resolveFocus = Command.resolve(FocusElement, Message.CompletedFocusElement())

describe("menu story", () => {
	test("ArrowDown on the trigger opens the menu on the first item without a focus Command", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowDown" })),
			Command.expectNone(),
			model((next) => {
				expect(next.popup._tag).toBe("Open")
				expect(focusOf(next)).toEqual(Option.some("new"))
			}),
		)
	})

	test("ArrowUp on the trigger opens the menu on the last enabled item", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowUp" })),
			model((next) => expect(focusOf(next)).toEqual(Option.some("docs"))),
		)
	})

	test("a mouse press opens with nothing focused and a touch press does not open", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTrigger({ pointerType: "touch" })),
			model((next) => expect(next.popup._tag).toBe("Closed")),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			model((next) => {
				expect(next.popup._tag).toBe("Open")
				expect(focusOf(next)).toEqual(Option.none())
			}),
		)
	})

	test("a single-selection menu opens on its selected item", () => {
		story(
			update,
			given(init({ id: "file", entries, selectionMode: "Single", selectedKeys: ["open"] })),
			message(Message.PressedTriggerKey({ key: "Enter" })),
			model((next) => expect(focusOf(next)).toEqual(Option.some("open"))),
		)
	})

	test("ArrowDown skips the disabled item and wraps from the last item to the first", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowDown" })),
			pressMenuKey("ArrowDown"),
			resolveFocus,
			pressMenuKey("ArrowDown"),
			Command.expectExact(FocusElement({ elementId: "file-item-share" })),
			resolveFocus,
			model((next) => expect(focusOf(next)).toEqual(Option.some("share"))),
			pressMenuKey("End"),
			resolveFocus,
			pressMenuKey("ArrowDown"),
			resolveFocus,
			model((next) => expect(focusOf(next)).toEqual(Option.some("new"))),
		)
	})

	test("Enter activates the focused item, closes the menu and selects it in single mode", () => {
		story(
			update,
			given(init({ id: "file", entries, selectionMode: "Single" })),
			message(Message.PressedTriggerKey({ key: "ArrowDown" })),
			pressMenuKey("Enter"),
			expectOutMessage(OutMessage.SelectedItem({ key: "new" })),
			model((next) => {
				expect(next.popup._tag).toBe("Closed")
				expect(next.selectedKeys).toEqual(["new"])
			}),
		)
	})

	test("a link item activated from the keyboard reports its href, a click reports a selection", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowUp" })),
			pressMenuKey(" "),
			expectOutMessage(OutMessage.ActivatedLink({ key: "docs", href: "/docs" })),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			message(Message.ClickedItem({ key: "docs" })),
			expectOutMessage(OutMessage.SelectedItem({ key: "docs" })),
		)
	})

	test("clicking a disabled item keeps the menu open and reports nothing", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			message(Message.ClickedItem({ key: "archive" })),
			expectNoOutMessage(),
			model((next) => expect(next.popup._tag).toBe("Open")),
		)
	})

	test("ArrowRight opens a submenu on its first item, ArrowLeft returns to the trigger", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowDown" })),
			pressMenuKey("ArrowDown"),
			resolveFocus,
			pressMenuKey("ArrowDown"),
			resolveFocus,
			pressMenuKey("ArrowRight"),
			Command.expectExact(FocusElement({ elementId: "file-item-email" })),
			resolveFocus,
			pressMenuKey("ArrowDown"),
			Command.expectExact(FocusElement({ elementId: "file-item-slack" })),
			resolveFocus,
			pressMenuKey("ArrowLeft"),
			Command.expectExact(FocusElement({ elementId: "file-item-share" })),
			resolveFocus,
			model((next) => {
				expect(submenuOf(next)).toEqual(Option.none())
				expect(focusOf(next)).toEqual(Option.some("share"))
			}),
		)
	})

	test("Escape closes only the submenu, a second Escape closes the menu", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			message(Message.ClickedItem({ key: "share" })),
			expectNoOutMessage(),
			Command.expectNone(),
			model((next) =>
				expect(Option.map(submenuOf(next), (s) => s.triggerKey)).toEqual(Option.some("share")),
			),
			message(Message.HoveredItem({ key: "email" })),
			resolveFocus,
			pressMenuKey("Escape"),
			resolveFocus,
			model((next) => {
				expect(next.popup._tag).toBe("Open")
				expect(submenuOf(next)).toEqual(Option.none())
			}),
			pressMenuKey("Escape"),
			Command.expectNone(),
			model((next) => expect(next.popup._tag).toBe("Closed")),
		)
	})

	test("hovering a disabled item highlights nothing and moves no focus", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			message(Message.HoveredItem({ key: "archive" })),
			Command.expectNone(),
			model((next) => expect(focusOf(next)).toEqual(Option.none())),
		)
	})

	test("typing focuses the matching item and the search resets after the timeout", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowDown" })),
			pressMenuKey("s"),
			Command.expectExact(
				FocusElement({ elementId: "file-item-share" }),
				WaitForTypeaheadReset({ search: "s" }),
			),
			resolveFocus,
			model((next) => expect(searchOf(next)).toBe("s")),
			Command.resolve(WaitForTypeaheadReset, Message.CompletedWaitForTypeaheadReset({ search: "s" })),
			model((next) => {
				expect(searchOf(next)).toBe("")
				expect(focusOf(next)).toEqual(Option.some("share"))
			}),
		)
	})

	test("a reset timer from an earlier keystroke leaves a longer search alone", () => {
		story(
			update,
			given(searching("sh", "share")),
			message(Message.CompletedWaitForTypeaheadReset({ search: "s" })),
			model((next) => expect(searchOf(next)).toBe("sh")),
		)
	})

	test("typeahead ignores modified keys and disabled items", () => {
		story(
			update,
			given(menu),
			message(Message.PressedTriggerKey({ key: "ArrowDown" })),
			pressMenuKey("o", true),
			Command.expectNone(),
			pressMenuKey("a"),
			Command.resolve(WaitForTypeaheadReset, Message.CompletedWaitForTypeaheadReset({ search: "a" })),
			model((next) => expect(focusOf(next)).toEqual(Option.some("new"))),
		)
	})

	// Bug: menu.ts:386 matches " " as activation before the typeahead branch (select.ts:216 guards it).
	test.fails("Space during a typeahead extends the search instead of activating", () => {
		story(
			update,
			given(searching("o", "open")),
			pressMenuKey(" "),
			expectNoOutMessage(),
			model((next) => expect(searchOf(next)).toBe("o ")),
			Command.resolve(WaitForTypeaheadReset, Message.CompletedWaitForTypeaheadReset({ search: "o " })),
		)
	})

	test("a context menu opens at the pointer with nothing focused", () => {
		story(
			update,
			given(init({ id: "file", entries, anchor: "Pointer" })),
			message(Message.PressedContextMenu({ offset: -40, crossOffset: 12 })),
			Command.expectNone(),
			model((next) => {
				expect(next.popup._tag === "Open" && next.popup.pointerOffset).toEqual(
					Option.some({ offset: -40, crossOffset: 12 }),
				)
				expect(focusOf(next)).toEqual(Option.none())
			}),
			message(Message.PressedOutside()),
			model((next) => expect(next.popup._tag).toBe("Closed")),
		)
	})
})
