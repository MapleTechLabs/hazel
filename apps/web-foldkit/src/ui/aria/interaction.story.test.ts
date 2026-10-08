// @vitest-environment jsdom
import { given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { disabledTargets, init, Message, stateOf, update } from "./interaction"

/** React Aria useHover, usePress and useFocusVisible rules. jsdom: the module builds its document subscriptions at import. */

describe("interaction story", () => {
	test("before any interaction there is no modality and focus counts as visible", () => {
		story(
			update,
			given(init()),
			model((next) => {
				expect(next.modality).toBeNull()
				expect(next.isFocusVisible).toBe(true)
				expect(stateOf(next, "save")).toEqual({
					isHovered: false,
					isFocusWithin: false,
					isPressed: false,
					isFocused: false,
					isFocusVisible: false,
				})
			}),
		)
	})

	test("a primary pointer press switches to pointer modality, hides the focus ring, and ends on pointerup", () => {
		story(
			update,
			given(init()),
			message(Message.PressedPointer({ target: "save", pointerType: "mouse", button: 0 })),
			model((next) => {
				expect(next.modality).toBe("pointer")
				expect(next.isFocusVisible).toBe(false)
				expect(stateOf(next, "save").isPressed).toBe(true)
				expect(stateOf(next, "cancel").isPressed).toBe(false)
			}),
			message(Message.ReleasedPointer()),
			model((next) => expect(next.press).toBeNull()),
		)
	})

	test("a right click does not start a press", () => {
		story(
			update,
			given(init()),
			message(Message.PressedPointer({ target: "save", pointerType: "mouse", button: 2 })),
			model((next) => {
				expect(next.press).toBeNull()
				expect(next.modality).toBeNull()
			}),
		)
	})

	test("dragging off a pressed target unpresses it and dragging back presses it again", () => {
		story(
			update,
			given(init()),
			message(Message.EnteredTarget({ target: "save" })),
			message(Message.PressedPointer({ target: "save", pointerType: "mouse", button: 0 })),
			message(Message.LeftTarget({ target: "save" })),
			model((next) => {
				expect(stateOf(next, "save").isPressed).toBe(false)
				expect(stateOf(next, "save").isHovered).toBe(false)
			}),
			message(Message.EnteredTarget({ target: "save" })),
			model((next) => expect(stateOf(next, "save").isPressed).toBe(true)),
		)
	})

	test("Space and Enter start a keyboard press that ends on keyup anywhere, other keys do not", () => {
		story(
			update,
			given(init()),
			message(Message.PressedKey({ target: "save", key: "a" })),
			model((next) => expect(next.press).toBeNull()),
			message(Message.PressedKey({ target: "save", key: " " })),
			model((next) => expect(next.press).toEqual({ target: "save", source: "keyboard", isInside: true })),
			message(Message.ReleasedDocumentKey({ key: "Escape" })),
			model((next) => expect(stateOf(next, "save").isPressed).toBe(true)),
			message(Message.ReleasedDocumentKey({ key: " " })),
			model((next) => expect(next.press).toBeNull()),
		)
	})

	test("a second key press while a press is held does not steal it", () => {
		story(
			update,
			given(init()),
			message(Message.PressedKey({ target: "save", key: "Enter" })),
			message(Message.PressedKey({ target: "cancel", key: "Enter" })),
			model((next) => expect(next.press?.target).toBe("save")),
			message(Message.ReleasedKey({ target: "cancel", key: "Enter" })),
			model((next) => expect(next.press?.target).toBe("save")),
			message(Message.ReleasedKey({ target: "save", key: "Enter" })),
			model((next) => expect(next.press).toBeNull()),
		)
	})

	test("Tab after a pointer press brings the focus ring back in keyboard modality", () => {
		story(
			update,
			given(init()),
			message(Message.PressedDocumentPointer()),
			message(Message.FocusedTarget({ target: "name", isTextInput: false })),
			model((next) => expect(stateOf(next, "name").isFocusVisible).toBe(false)),
			message(Message.PressedDocumentKey({ key: "Tab" })),
			model((next) => {
				expect(next.modality).toBe("keyboard")
				expect(stateOf(next, "name").isFocusVisible).toBe(true)
			}),
		)
	})

	test("typing into a text input focused by pointer keeps the ring hidden until Tab or Escape", () => {
		story(
			update,
			given(init()),
			message(Message.PressedPointer({ target: "email", pointerType: "mouse", button: 0 })),
			message(Message.FocusedTarget({ target: "email", isTextInput: true })),
			message(Message.PressedDocumentKey({ key: "a" })),
			model((next) => {
				expect(next.modality).toBe("keyboard")
				expect(stateOf(next, "email").isFocusVisible).toBe(false)
			}),
			message(Message.PressedDocumentKey({ key: "Escape" })),
			model((next) => expect(stateOf(next, "email").isFocusVisible).toBe(true)),
		)
	})

	test("focus with no key or pointer event before it is virtual and shows the ring", () => {
		story(
			update,
			given(init()),
			message(Message.PressedDocumentPointer()),
			message(Message.FocusedTarget({ target: "first", isTextInput: false })),
			message(Message.FocusedTarget({ target: "dialog-close", isTextInput: false })),
			model((next) => {
				expect(next.modality).toBe("virtual")
				expect(stateOf(next, "dialog-close").isFocusVisible).toBe(true)
			}),
		)
	})

	test("a pointer press keeps the event armed for its own focus, so that focus is not virtual", () => {
		story(
			update,
			given(init()),
			message(Message.PressedPointer({ target: "save", pointerType: "mouse", button: 0 })),
			message(Message.FocusedTarget({ target: "save", isTextInput: false })),
			model((next) => expect(next.hasEventBeforeFocus).toBe(true)),
			message(Message.ReleasedPointer()),
			message(Message.FocusedTarget({ target: "save", isTextInput: false })),
			model((next) => {
				expect(next.modality).toBe("pointer")
				expect(next.hasEventBeforeFocus).toBe(false)
			}),
		)
	})

	test("nested targets hover together and blurring another target leaves focus alone", () => {
		story(
			update,
			given(init()),
			message(Message.EnteredTarget({ target: "group" })),
			message(Message.EnteredTarget({ target: "input" })),
			message(Message.EnteredTarget({ target: "input" })),
			message(Message.LeftTarget({ target: "input" })),
			message(Message.FocusedTarget({ target: "input", isTextInput: true })),
			message(Message.BlurredTarget({ target: "group" })),
			model((next) => {
				expect(next.hovered).toEqual(["group"])
				expect(stateOf(next, "input").isFocused).toBe(true)
			}),
			message(Message.BlurredTarget({ target: "input" })),
			model((next) => expect(next.focused).toBeNull()),
		)
	})

	test("focus inside a group shows the group's focus ring in keyboard modality", () => {
		story(
			update,
			given(init()),
			message(Message.PressedDocumentKey({ key: "Tab" })),
			message(Message.EnteredFocusWithin({ target: "radios" })),
			message(Message.EnteredFocusWithin({ target: "radios" })),
			model((next) => {
				expect(next.focusWithin).toEqual(["radios"])
				expect(stateOf(next, "radios").isFocusWithin).toBe(true)
				expect(stateOf(next, "radios").isFocusVisible).toBe(true)
			}),
			message(Message.LeftFocusWithin({ target: "radios" })),
			model((next) => expect(stateOf(next, "radios").isFocusWithin).toBe(false)),
		)
	})
})

describe("disabledTargets", () => {
	test("disabling a hovered and focused button ends its hover and focus but not other targets'", () => {
		const hoveredAndFocused = [
			Message.EnteredTarget({ target: "toolbar" }),
			Message.EnteredTarget({ target: "save" }),
			Message.FocusedTarget({ target: "save", isTextInput: false }),
		].reduce((current, next) => update(current, next).model, init())
		const disabled = disabledTargets(hoveredAndFocused, ["save"])
		expect(disabled.hovered).toEqual(["toolbar"])
		expect(disabled.focused).toBeNull()
	})

	test("disabling targets that are neither hovered nor focused returns the same Model", () => {
		const hovered = update(init(), Message.EnteredTarget({ target: "toolbar" })).model
		expect(disabledTargets(hovered, ["save"])).toBe(hovered)
	})
})
