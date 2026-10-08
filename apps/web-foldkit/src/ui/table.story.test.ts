import { Option } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { Announce, FocusRowFromTable, init, Message, sortOf, update } from "./table"

/** React Aria Table: replace vs toggle selection, select all, sorting, grid focus and announcements. */

const members = init({ id: "members", selectionMode: "single" })
const invite = init({ id: "invite", selectionMode: "multiple", selectedKeys: ["grace"] })
const selected = (text: string) => Announce({ message: text, timeout: 7000 })
const sorted = (direction: string) =>
	Announce({ message: `sorted by column  in ${direction} order`, timeout: 500 })
const press = (row: string, rowText: string) =>
	message(Message.PressedRow({ row, isSelectable: true, rowText }))

describe("table story", () => {
	test("pressing a row in single mode replaces the selection and announces the row", () => {
		story(
			update,
			given({ ...members, selectedKeys: ["grace"] }),
			press("ada", "Ada Lovelace"),
			Command.expectExact(selected("Ada Lovelace selected.")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) => {
				expect(next.selectedKeys).toEqual(["ada"])
				expect(next.modality).toBe("Pointer")
			}),
		)
	})

	test("arrow navigation in single mode moves the selection with focus", () => {
		story(
			update,
			given(members),
			message(Message.NavigatedToRow({ row: "alan", isSelectable: true, rowText: "Alan Turing" })),
			Command.expectExact(selected("Alan Turing selected.")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) => {
				expect(next.selectedKeys).toEqual(["alan"])
				expect(next.modality).toBe("Keyboard")
			}),
		)
	})

	test("arrow navigation in multiple mode only moves focus; Space toggles the row", () => {
		story(
			update,
			given(invite),
			message(Message.NavigatedToRow({ row: "ada", isSelectable: true, rowText: "Ada Lovelace" })),
			Command.expectNone(),
			model((next) => expect(next.selectedKeys).toEqual(["grace"])),
			message(Message.PressedRowSpace({ row: "ada", rowText: "Ada Lovelace" })),
			Command.expectExact(selected("Ada Lovelace selected. 2 items selected.")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) => expect(next.selectedKeys).toEqual(["grace", "ada"])),
		)
	})

	test("pressing a selected row in multiple mode deselects it", () => {
		story(
			update,
			given(invite),
			press("grace", "Grace Hopper"),
			Command.expectExact(selected("Grace Hopper not selected.")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) => expect(next.selectedKeys).toEqual([])),
		)
	})

	test("Select All selects every enabled row, and a second press clears them", () => {
		const keys = ["ada", "grace", "alan"]
		story(
			update,
			given(invite),
			message(Message.ToggledAll({ keys })),
			Command.expectExact(selected("All items selected.")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) => expect(next.selectedKeys).toEqual(keys)),
			message(Message.ToggledAll({ keys })),
			Command.expectExact(selected("No items selected.")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) => expect(next.selectedKeys).toEqual([])),
		)
	})

	test("rows that are not selectable, or tables without selection, never change selection", () => {
		story(
			update,
			given(init({ id: "plain" })),
			press("ada", "Ada Lovelace"),
			Command.expectNone(),
			message(Message.PressedRow({ row: "ada", isSelectable: false, rowText: "Ada Lovelace" })),
			Command.expectNone(),
			model((next) => expect(next.selectedKeys).toEqual([])),
		)
	})

	test("clicking a sortable column sorts ascending, then flips direction, announcing each change", () => {
		story(
			update,
			given(members),
			message(Message.ClickedColumn({ column: "name" })),
			Command.expectExact(sorted("ascending")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) =>
				expect(sortOf(next)).toEqual(Option.some({ column: "name", direction: "ascending" })),
			),
			message(Message.ClickedColumn({ column: "name" })),
			Command.expectExact(sorted("descending")),
			Command.resolve(Announce, Message.CompletedAnnounce()),
			model((next) =>
				expect(sortOf(next)).toEqual(Option.some({ column: "name", direction: "descending" })),
			),
		)
	})

	test("sorting another column in the same direction is silent, since the column name is never announced", () => {
		story(
			update,
			given(init({ id: "members", sort: { column: "name", direction: "ascending" } })),
			message(Message.ClickedColumn({ column: "channels" })),
			Command.expectNone(),
			model((next) =>
				expect(sortOf(next)).toEqual(Option.some({ column: "channels", direction: "ascending" })),
			),
		)
	})

	test("focusing the table redirects focus to the target row", () => {
		story(
			update,
			given(members),
			message(Message.FocusedTable({ targetRow: "ada" })),
			Command.expectExact(FocusRowFromTable({ tableId: "members", rowElementId: "members-row-ada" })),
			Command.resolve(FocusRowFromTable, Message.CompletedFocusRow()),
		)
	})

	test("focus moves between rows, cells and column headers and leaves on blur", () => {
		story(
			update,
			given(members),
			message(Message.FocusedRow({ row: "ada" })),
			model((next) => expect(next.focus).toEqual({ _tag: "Row", row: "ada" })),
			message(Message.FocusedCell({ row: "ada", column: "role" })),
			model((next) => expect(next.focus).toEqual({ _tag: "Cell", row: "ada", column: "role" })),
			message(Message.FocusedColumn({ column: "name" })),
			model((next) => expect(next.focus).toEqual({ _tag: "Column", column: "name" })),
			message(Message.BlurredTable()),
			model((next) => expect(next.focus).toEqual({ _tag: "Outside" })),
		)
	})
})
