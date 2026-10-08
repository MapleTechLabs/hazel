import { Option } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { FocusRow, init, Message, update } from "./tree"

/** React Aria Tree: expansion by chevron and arrow keys, roving row focus, input modality. */

const channels = init({ id: "tree-channels", expandedKeys: ["engineering"] })

describe("tree story", () => {
	test("tabbing into the tree hands focus to the first row only while the tree itself is focused", () => {
		story(
			update,
			given(channels),
			message(Message.FocusedTree({ targetKey: "engineering" })),
			Command.expectExact(
				FocusRow({ rowElementId: "tree-channels-engineering", onlyFromId: Option.some("tree-channels") }),
			),
			Command.resolve(FocusRow, Message.CompletedFocusRow()),
			model((next) => expect(next).toEqual(channels)),
		)
	})

	test("clicking a chevron collapses an expanded row and focuses it", () => {
		story(
			update,
			given(channels),
			message(Message.ClickedChevron({ key: "engineering" })),
			Command.expectExact(FocusRow({ rowElementId: "tree-channels-engineering", onlyFromId: Option.none() })),
			Command.resolve(FocusRow, Message.CompletedFocusRow()),
			model((next) => {
				expect(next.expandedKeys).toEqual([])
				expect(next.modality).toBe("Pointer")
			}),
		)
	})

	test("clicking a collapsed chevron expands the row", () => {
		story(
			update,
			given(channels),
			message(Message.ClickedChevron({ key: "design" })),
			Command.resolve(FocusRow, Message.CompletedFocusRow()),
			model((next) => expect(next.expandedKeys).toEqual(["engineering", "design"])),
		)
	})

	test("ArrowRight expands and ArrowLeft collapses with keyboard modality", () => {
		story(
			update,
			given(channels),
			message(Message.PressedExpandKey({ key: "design" })),
			Command.expectNone(),
			model((next) => {
				expect(next.expandedKeys).toEqual(["engineering", "design"])
				expect(next.modality).toBe("Keyboard")
			}),
			message(Message.PressedCollapseKey({ key: "engineering" })),
			model((next) => expect(next.expandedKeys).toEqual(["design"])),
		)
	})

	test("expanding an already expanded row does not duplicate it", () => {
		story(
			update,
			given(channels),
			message(Message.PressedExpandKey({ key: "engineering" })),
			model((next) => expect(next.expandedKeys).toEqual(["engineering"])),
		)
	})

	test("row focus is tracked until that row blurs", () => {
		story(
			update,
			given(channels),
			message(Message.FocusedRow({ key: "frontend" })),
			message(Message.BlurredRow({ key: "backend" })),
			model((next) => expect(next.maybeFocusedKey).toEqual(Option.some("frontend"))),
			message(Message.BlurredRow({ key: "frontend" })),
			model((next) => expect(next.maybeFocusedKey).toEqual(Option.none())),
		)
	})

	test("pressing a row switches to pointer modality and arrow navigation back to keyboard", () => {
		story(
			update,
			given(channels),
			message(Message.PressedRow()),
			model((next) => expect(next.modality).toBe("Pointer")),
			message(Message.NavigatedToRow()),
			model((next) => expect(next.modality).toBe("Keyboard")),
		)
	})
})
