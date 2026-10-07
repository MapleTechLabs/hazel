import { Effect, Option, Schema } from "effect"
import type { Update } from "foldkit"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Collection from "./aria/collection"

/**
 * Port of `components/ui/table.tsx` (React Aria Table): row selection (single, replace
 * behavior), sortable columns, grid focus (rows, cells, column headers) and arrow-key
 * navigation. The view lives in `table-view.ts`.
 */

// MODEL

export const SortDirection = Schema.Literals(["ascending", "descending"])
export type SortDirection = typeof SortDirection.Type

export const SortDescriptor = Schema.Struct({ column: Schema.String, direction: SortDirection })
export type SortDescriptor = typeof SortDescriptor.Type

export const SelectionMode = Schema.Literals(["none", "single"])
export type SelectionMode = typeof SelectionMode.Type

export const Focus = Schema.Union([
	Schema.TaggedStruct("Outside", {}),
	Schema.TaggedStruct("Row", { row: Schema.String }),
	Schema.TaggedStruct("Cell", { row: Schema.String, column: Schema.String }),
	Schema.TaggedStruct("Column", { column: Schema.String }),
])
export type Focus = typeof Focus.Type

export const Model = Schema.Struct({
	id: Schema.String,
	selectionMode: SelectionMode,
	selectedKeys: Schema.Array(Schema.String),
	maybeSort: Schema.Option(SortDescriptor),
	focus: Focus,
	maybeHoveredRow: Schema.Option(Schema.String),
	maybeHoveredColumn: Schema.Option(Schema.String),
	modality: Collection.Modality,
})
export type Model = typeof Model.Type

export const init = (config: {
	readonly id: string
	readonly selectionMode?: SelectionMode
	readonly selectedKeys?: ReadonlyArray<string>
	readonly sort?: SortDescriptor
}): Model => ({
	id: config.id,
	selectionMode: config.selectionMode ?? "none",
	selectedKeys: config.selectedKeys ?? [],
	maybeSort: Option.fromNullishOr(config.sort),
	focus: { _tag: "Outside" },
	maybeHoveredRow: Option.none(),
	maybeHoveredColumn: Option.none(),
	modality: "Unknown",
})

/** The current sort, for the parent to order its rows (RA's controlled `sortDescriptor`). */
export const sortOf = (model: Model): Option.Option<SortDescriptor> => model.maybeSort

// MESSAGE

export const Message = defineMessageUnion({
	HoveredRow: { row: Schema.String },
	UnhoveredRow: { row: Schema.String },
	HoveredColumn: { column: Schema.String },
	UnhoveredColumn: { column: Schema.String },
	PressedRow: { row: Schema.String, isSelectable: Schema.Boolean },
	ClickedColumn: { column: Schema.String },
	FocusedTable: { targetRow: Schema.String },
	FocusedRow: { row: Schema.String },
	FocusedCell: { row: Schema.String, column: Schema.String },
	FocusedColumn: { column: Schema.String },
	BlurredTable: {},
	NavigatedToRow: { row: Schema.String, isSelectable: Schema.Boolean },
	ReleasedKey: {},
	CompletedFocusRow: {},
})
export type Message = typeof Message.Type

// COMMAND

export const rowId = (model: Model, row: string) => `${model.id}-row-${row}`
export const cellId = (model: Model, row: string, column: string) => `${model.id}-${row}-${column}`
export const columnId = (model: Model, column: string) => `${model.id}-${column}`

// NOTE: a key press can move focus off the table before this runs; only redirect if it hasn't.
const FocusRowFromTable = Command.define("FocusRowFromTable", {
	args: { tableId: Schema.String, rowElementId: Schema.String },
	messages: [Message.CompletedFocusRow],
	execute: ({ tableId, rowElementId }) =>
		Effect.sync(() => {
			if (document.activeElement?.id === tableId) {
				document.getElementById(rowElementId)?.focus()
			}
			return Message.CompletedFocusRow()
		}),
})

// UPDATE

const withFocus = (model: Model, focus: Focus) => modifyFields(model, { focus: () => focus })
const withModality = (model: Model, modality: Collection.Modality) =>
	modifyFields(model, { modality: () => modality })

const selectRow = (model: Model, row: string, isSelectable: boolean) =>
	isSelectable && model.selectionMode === "single"
		? modifyFields(model, { selectedKeys: () => [row] })
		: model

const nextSort = (model: Model, column: string): SortDescriptor =>
	Option.match(model.maybeSort, {
		onNone: () => ({ column, direction: "ascending" }),
		onSome: (sort) =>
			sort.column === column
				? { column, direction: sort.direction === "ascending" ? "descending" : "ascending" }
				: { column, direction: "ascending" },
	})

const without = (maybeKey: Option.Option<string>, key: string) =>
	Option.filter(maybeKey, (other) => other !== key)

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		HoveredRow: ({ row }) => ({
			model: modifyFields(model, { maybeHoveredRow: () => Option.some(row) }),
		}),
		UnhoveredRow: ({ row }) => ({
			model: modifyFields(model, { maybeHoveredRow: (maybe) => without(maybe, row) }),
		}),
		HoveredColumn: ({ column }) => ({
			model: modifyFields(model, { maybeHoveredColumn: () => Option.some(column) }),
		}),
		UnhoveredColumn: ({ column }) => ({
			model: modifyFields(model, { maybeHoveredColumn: (maybe) => without(maybe, column) }),
		}),
		PressedRow: ({ row, isSelectable }) => ({
			model: selectRow(withModality(model, "Pointer"), row, isSelectable),
		}),
		ClickedColumn: ({ column }) => ({
			model: modifyFields(withModality(model, "Pointer"), {
				maybeSort: () => Option.some(nextSort(model, column)),
			}),
		}),
		FocusedTable: ({ targetRow }) => ({
			model,
			commands: [FocusRowFromTable({ tableId: model.id, rowElementId: rowId(model, targetRow) })],
		}),
		FocusedRow: ({ row }) => ({ model: withFocus(model, { _tag: "Row", row }) }),
		FocusedCell: ({ row, column }) => ({ model: withFocus(model, { _tag: "Cell", row, column }) }),
		FocusedColumn: ({ column }) => ({ model: withFocus(model, { _tag: "Column", column }) }),
		BlurredTable: () => ({ model: withFocus(model, { _tag: "Outside" }) }),
		NavigatedToRow: ({ row, isSelectable }) => ({
			model: selectRow(withModality(model, "Keyboard"), row, isSelectable),
		}),
		ReleasedKey: () => ({ model: withModality(model, "Keyboard") }),
		CompletedFocusRow: () => ({ model }),
	})
