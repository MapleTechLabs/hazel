import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	FocusElement,
	init,
	item,
	Message,
	type Model,
	OutMessage,
	update,
	WaitForTypeaheadReset,
} from "./select"

/** React Aria Select: open strategies, non-wrapping list navigation, typeahead and selection. */

const items = [
	item("never", "Don't clear"),
	item("30m", "30 minutes"),
	item("1h", "1 hour", true),
	item("today", "Today"),
	item("week", "This week"),
]
const select = init({ id: "clear", items })
const triggerKey = (key: string) => message(Message.PressedTriggerKey({ key }))
const listKey = (key: string, isModified = false) => message(Message.PressedListKey({ key, isModified }))
const focusOf = (next: Model) => (next.popup._tag === "Open" ? next.popup.focusedKey : Option.none())
const searchOf = (next: Model) => (next.popup._tag === "Open" ? next.popup.search : "")
const resolveFocus = Command.resolve(FocusElement, Message.CompletedFocusElement())
const openOn = (focusedKey: string, search = ""): Model => ({
	...select,
	popup: {
		_tag: "Open",
		focusedKey: Option.some(focusedKey),
		hoveredKey: Option.none(),
		modality: "Keyboard",
		search,
	},
})

describe("select story", () => {
	test("ArrowDown on the trigger opens the list on the first option, ArrowUp on the last", () => {
		story(
			update,
			given(select),
			triggerKey("ArrowDown"),
			Command.expectNone(),
			model((next) => expect(focusOf(next)).toEqual(Option.some("never"))),
			message(Message.PressedOutside()),
			triggerKey("ArrowUp"),
			model((next) => expect(focusOf(next)).toEqual(Option.some("week"))),
		)
	})

	test("opening focuses the selected option whatever the key", () => {
		story(
			update,
			given(init({ id: "clear", items, selectedKey: "today" })),
			triggerKey("ArrowUp"),
			model((next) => expect(focusOf(next)).toEqual(Option.some("today"))),
		)
	})

	test("a disabled select does not open from a key or a press", () => {
		story(
			update,
			given(init({ id: "clear", items, isDisabled: true })),
			triggerKey("Enter"),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			model((next) => expect(next.popup._tag).toBe("Closed")),
		)
	})

	test("a mouse press opens with no option focused and a touch press does not open", () => {
		story(
			update,
			given(select),
			message(Message.PressedTrigger({ pointerType: "touch" })),
			model((next) => expect(next.popup._tag).toBe("Closed")),
			message(Message.PressedTrigger({ pointerType: "mouse" })),
			model((next) => {
				expect(next.popup._tag).toBe("Open")
				expect(focusOf(next)).toEqual(Option.none())
			}),
		)
	})

	test("ArrowRight on the closed trigger selects the next option without opening", () => {
		story(
			update,
			given(init({ id: "clear", items, selectedKey: "30m" })),
			triggerKey("ArrowRight"),
			expectOutMessage(OutMessage.ChangedSelection({ key: "today" })),
			model((next) => {
				expect(next.selectedKey).toEqual(Option.some("today"))
				expect(next.popup._tag).toBe("Closed")
			}),
			triggerKey("ArrowLeft"),
			expectOutMessage(OutMessage.ChangedSelection({ key: "30m" })),
		)
	})

	// T5: an arrow at the end of the list is a no-op and reports nothing.
	test("ArrowRight on the last option keeps the selection and reports nothing", () => {
		story(
			update,
			given(init({ id: "clear", items, selectedKey: "week" })),
			triggerKey("ArrowRight"),
			expectNoOutMessage(),
		)
	})

	test("list navigation skips disabled options and stops at the ends", () => {
		story(
			update,
			given(openOn("30m")),
			listKey("ArrowDown"),
			Command.expectExact(FocusElement({ elementId: "clear-listbox-option-today" })),
			resolveFocus,
			listKey("End"),
			resolveFocus,
			listKey("ArrowDown"),
			resolveFocus,
			model((next) => expect(focusOf(next)).toEqual(Option.some("week"))),
			listKey("Home"),
			resolveFocus,
			listKey("ArrowUp"),
			resolveFocus,
			model((next) => expect(focusOf(next)).toEqual(Option.some("never"))),
		)
	})

	test("Enter selects the focused option and closes the list", () => {
		story(
			update,
			given(openOn("today")),
			listKey("Enter"),
			expectOutMessage(OutMessage.ChangedSelection({ key: "today" })),
			Command.expectNone(),
			model((next) => {
				expect(next.selectedKey).toEqual(Option.some("today"))
				expect(next.popup._tag).toBe("Closed")
			}),
		)
	})

	test("Escape closes the list and keeps the previous selection", () => {
		story(
			update,
			given({ ...openOn("today"), selectedKey: Option.some("never") }),
			listKey("Escape"),
			expectNoOutMessage(),
			model((next) => {
				expect(next.popup._tag).toBe("Closed")
				expect(next.selectedKey).toEqual(Option.some("never"))
			}),
		)
	})

	test("typing focuses the matching option and the search resets after the timeout", () => {
		story(
			update,
			given(openOn("never")),
			listKey("t"),
			Command.expectExact(
				FocusElement({ elementId: "clear-listbox-option-today" }),
				WaitForTypeaheadReset({ search: "t" }),
			),
			resolveFocus,
			model((next) => expect(searchOf(next)).toBe("t")),
			Command.resolve(WaitForTypeaheadReset, Message.CompletedWaitForTypeaheadReset({ search: "t" })),
			model((next) => {
				expect(searchOf(next)).toBe("")
				expect(focusOf(next)).toEqual(Option.some("today"))
			}),
		)
	})

	test("Space during a typeahead extends the search instead of selecting", () => {
		story(
			update,
			given(openOn("week", "this")),
			listKey(" "),
			expectNoOutMessage(),
			resolveFocus,
			model((next) => expect(searchOf(next)).toBe("this ")),
			Command.resolve(
				WaitForTypeaheadReset,
				Message.CompletedWaitForTypeaheadReset({ search: "this " }),
			),
		)
	})

	test("a stale reset timer leaves a longer search alone, modified keys do not search", () => {
		story(
			update,
			given(openOn("week", "th")),
			message(Message.CompletedWaitForTypeaheadReset({ search: "t" })),
			model((next) => expect(searchOf(next)).toBe("th")),
			listKey("a", true),
			Command.expectNone(),
			model((next) => expect(searchOf(next)).toBe("th")),
		)
	})

	test("a disabled option can be hovered but not focused or clicked", () => {
		story(
			update,
			given(openOn("never")),
			message(Message.HoveredOption({ key: "1h" })),
			Command.expectNone(),
			model((next) => expect(focusOf(next)).toEqual(Option.some("never"))),
			message(Message.ClickedOption({ key: "1h" })),
			expectNoOutMessage(),
			message(Message.HoveredOption({ key: "today" })),
			resolveFocus,
			message(Message.ClickedOption({ key: "today" })),
			expectOutMessage(OutMessage.ChangedSelection({ key: "today" })),
		)
	})
})
