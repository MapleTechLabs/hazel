import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { AnnounceChoiceBoxSelection, FocusChoiceBoxItem, init, Message, update } from "./choice-box"

/** React Aria GridList as a ChoiceBox: roving focus by row and column, toggle selection, announcements. */

// The view passes only the enabled keys, so "enterprise" (disabled) never appears here.
const keys = ["free", "pro", "team", "custom"]
const plan = init({ id: "plan", selectedKeys: ["pro"] })
const focusedOn = (key: string) => ({ ...plan, focusedKey: key })
const pressKey = (key: string, columns = 1) =>
	message(Message.PressedGridKey({ key, keys, columns, isReadOnly: false }))
const focusOf = (key: string) => FocusChoiceBoxItem({ elementId: `plan-${key}` })

describe("choice-box story", () => {
	test("tabbing into the grid focuses the selected item", () => {
		story(
			update,
			given(plan),
			message(Message.FocusedGrid({ keys })),
			Command.expectExact(focusOf("pro")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.focusedKey).toBe("pro")),
		)
	})

	test("tabbing into a grid with no selection focuses the first item", () => {
		story(
			update,
			given(init({ id: "plan" })),
			message(Message.FocusedGrid({ keys })),
			Command.expectExact(focusOf("free")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
		)
	})

	test("ArrowDown in a stack moves to the next item", () => {
		story(
			update,
			given(focusedOn("free")),
			pressKey("ArrowDown"),
			Command.expectExact(focusOf("pro")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
			model((next) => expect(next.focusedKey).toBe("pro")),
		)
	})

	test("ArrowDown in a two-column grid moves a whole row, ArrowRight one item", () => {
		story(
			update,
			given(focusedOn("free")),
			pressKey("ArrowDown", 2),
			Command.expectExact(focusOf("team")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
			pressKey("ArrowRight", 2),
			Command.expectExact(focusOf("custom")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
		)
	})

	test("ArrowUp on the first item goes nowhere", () => {
		story(
			update,
			given(focusedOn("free")),
			pressKey("ArrowUp"),
			Command.expectNone(),
			model((next) => expect(next.focusedKey).toBe("free")),
		)
	})

	test("Home and End jump to the first and last item", () => {
		story(
			update,
			given(focusedOn("pro")),
			pressKey("End"),
			Command.expectExact(focusOf("custom")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
			pressKey("Home"),
			Command.expectExact(focusOf("free")),
			Command.resolve(FocusChoiceBoxItem, Message.CompletedFocusItem()),
		)
	})

	test("Space selects the focused item; single selection stays silent since rows have no text", () => {
		story(
			update,
			given(focusedOn("team")),
			pressKey(" "),
			Command.expectNone(),
			model((next) => expect(next.selectedKeys).toEqual(["team"])),
			pressKey("Enter"),
			model((next) => expect(next.selectedKeys).toEqual([])),
		)
	})

	test("Space with no focused item selects nothing", () => {
		story(
			update,
			given(plan),
			pressKey(" "),
			Command.expectNone(),
			model((next) => expect(next.selectedKeys).toEqual(["pro"])),
		)
	})

	test("clicking items in multiple mode toggles them and announces the count", () => {
		story(
			update,
			given(init({ id: "channels", selectionMode: "multiple", selectedKeys: ["general"] })),
			message(Message.ClickedItem({ key: "random" })),
			Command.expectExact(AnnounceChoiceBoxSelection({ message: "2 items selected." })),
			Command.resolve(AnnounceChoiceBoxSelection, Message.CompletedAnnounceSelection()),
			model((next) => {
				expect(next.selectedKeys).toEqual(["general", "random"])
				expect(next.focusedKey).toBe("random")
			}),
			message(Message.ToggledSelectionCheckbox({ key: "general" })),
			Command.expectExact(AnnounceChoiceBoxSelection({ message: "1 item selected." })),
			Command.resolve(AnnounceChoiceBoxSelection, Message.CompletedAnnounceSelection()),
			model((next) => expect(next.selectedKeys).toEqual(["random"])),
		)
	})
})
