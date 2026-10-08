import { Option } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	Announce,
	FocusInput,
	init,
	item,
	Message,
	type Model,
	OutMessage,
	update,
	visibleItems,
} from "./combo-box"

/** React Aria ComboBox (menuTrigger "input"): filtering, virtual focus, commit and revert. */

const items = [
	item("general", "General"),
	item("design", "Design"),
	item("engineering", "Engineering", true),
	item("cafe", "Café"),
]
const comboBox = init({ id: "channel", items, isAppleDevice: false })
const inputKey = (key: string) => message(Message.PressedInputKey({ key }))
const focusOf = (next: Model) => (next.popup._tag === "Open" ? next.popup.focusedKey : Option.none())
const visibleKeys = (next: Model) =>
	next.popup._tag === "Open" ? visibleItems(next, next.popup).map((found) => found.key) : []
const announced = (text: string) => Command.resolve(Announce({ message: text }), Message.CompletedAnnounce())

describe("combo box story", () => {
	test("typing filters the options ignoring accents, opens the list and announces the count", () => {
		story(
			update,
			given(comboBox),
			message(Message.ChangedInput({ value: "cafe" })),
			Command.expectExact(Announce({ message: "1 option available." })),
			announced("1 option available."),
			model((next) => {
				expect(visibleKeys(next)).toEqual(["cafe"])
				expect(focusOf(next)).toEqual(Option.none())
			}),
		)
	})

	test("typing text that matches nothing closes the list", () => {
		story(
			update,
			given(comboBox),
			message(Message.ChangedInput({ value: "zzz" })),
			Command.expectNone(),
			model((next) => {
				expect(next.popup._tag).toBe("Closed")
				expect(next.inputValue).toBe("zzz")
			}),
		)
	})

	test("ArrowDown on a closed input shows every option and focuses the first, ArrowUp the last", () => {
		story(
			update,
			given(comboBox),
			inputKey("ArrowDown"),
			Command.expectNone(),
			model((next) => {
				expect(visibleKeys(next)).toEqual(["general", "design", "engineering", "cafe"])
				expect(focusOf(next)).toEqual(Option.some("general"))
			}),
			inputKey("Escape"),
			inputKey("ArrowUp"),
			model((next) => expect(focusOf(next)).toEqual(Option.some("cafe"))),
		)
	})

	test("arrow keys skip the disabled option and stop at the ends", () => {
		story(
			update,
			given(comboBox),
			inputKey("ArrowDown"),
			inputKey("ArrowDown"),
			inputKey("ArrowDown"),
			model((next) => expect(focusOf(next)).toEqual(Option.some("cafe"))),
			inputKey("ArrowDown"),
			model((next) => expect(focusOf(next)).toEqual(Option.some("cafe"))),
		)
	})

	test("Enter commits the focused option, closes the list and fills the input with its label", () => {
		story(
			update,
			given(comboBox),
			inputKey("ArrowUp"),
			inputKey("Enter"),
			expectOutMessage(OutMessage.ChangedSelection({ key: "cafe" })),
			model((next) => {
				expect(next.popup._tag).toBe("Closed")
				expect(next.selectedKey).toEqual(Option.some("cafe"))
				expect(next.inputValue).toBe("Café")
			}),
		)
	})

	test("Enter with nothing focused closes the list and reverts the typed text", () => {
		story(
			update,
			given(init({ id: "channel", items, selectedKey: "design", isAppleDevice: false })),
			message(Message.ChangedInput({ value: "gen" })),
			announced("1 option available."),
			inputKey("Enter"),
			expectNoOutMessage(),
			model((next) => {
				expect(next.popup._tag).toBe("Closed")
				expect(next.inputValue).toBe("Design")
			}),
		)
	})

	test("Escape and blur both close the list and restore the selected label", () => {
		story(
			update,
			given(init({ id: "channel", items, selectedKey: "general", isAppleDevice: false })),
			message(Message.ChangedInput({ value: "des" })),
			announced("1 option available."),
			inputKey("Escape"),
			model((next) => expect(next.inputValue).toBe("General")),
			message(Message.FocusedInput()),
			message(Message.ChangedInput({ value: "des" })),
			announced("1 option available."),
			message(Message.BlurredInput()),
			model((next) => {
				expect(next.popup._tag).toBe("Closed")
				expect(next.isFocused).toBe(false)
				expect(next.inputValue).toBe("General")
			}),
		)
	})

	test("the button toggles every option open on the selection and keeps focus in the input", () => {
		story(
			update,
			given(init({ id: "channel", items, selectedKey: "design", isAppleDevice: false })),
			message(Message.ChangedInput({ value: "Des" })),
			announced("1 option available."),
			message(Message.BlurredInput()),
			message(Message.PressedButton()),
			Command.expectExact(FocusInput({ elementId: "channel-input" })),
			Command.resolve(FocusInput, Message.CompletedFocusInput()),
			model((next) => {
				expect(visibleKeys(next)).toHaveLength(4)
				expect(focusOf(next)).toEqual(Option.some("design"))
			}),
			message(Message.PressedButton()),
			Command.resolve(FocusInput, Message.CompletedFocusInput()),
			model((next) => expect(next.popup._tag).toBe("Closed")),
		)
	})

	test("clicking a disabled option selects nothing, clicking an enabled one commits it", () => {
		story(
			update,
			given(comboBox),
			inputKey("ArrowDown"),
			message(Message.ClickedOption({ key: "engineering" })),
			expectNoOutMessage(),
			model((next) => expect(next.popup._tag).toBe("Open")),
			message(Message.ClickedOption({ key: "design" })),
			expectOutMessage(OutMessage.ChangedSelection({ key: "design" })),
			model((next) => expect(next.inputValue).toBe("Design")),
		)
	})

	test("on Apple devices opening also announces the focused option for VoiceOver", () => {
		story(
			update,
			given(init({ id: "channel", items, selectedKey: "design", isAppleDevice: true })),
			inputKey("ArrowDown"),
			Command.expectExact(
				Announce({ message: "4 options available." }),
				Announce({ message: "Design, selected" }),
			),
			announced("4 options available."),
			announced("Design, selected"),
			inputKey("ArrowDown"),
			Command.expectExact(Announce({ message: "Café" })),
			announced("Café"),
		)
	})
})
