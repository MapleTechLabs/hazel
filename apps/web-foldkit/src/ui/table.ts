import { Effect, Option, Schema } from "effect"
import { Subscription, type Update } from "foldkit"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { announce, gridSelectionMessage } from "./aria/announcer"
import * as Collection from "./aria/collection"
import * as Interaction from "./aria/interaction"

/**
 * Port of `components/ui/table.tsx` (React Aria Table): row selection (single with replace
 * behavior, multiple with toggle behavior and selection checkboxes), sortable columns, grid
 * focus (rows, cells, column headers) and arrow-key navigation. The view lives in `table-view.ts`.
 */

// MODEL

export const SortDirection = Schema.Literals(["ascending", "descending"])
export type SortDirection = typeof SortDirection.Type

export const SortDescriptor = Schema.Struct({ column: Schema.String, direction: SortDirection })
export type SortDescriptor = typeof SortDescriptor.Type

export const SelectionMode = Schema.Literals(["none", "single", "multiple"])
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
	/** Hover, press and focus of the selection checkboxes. */
	interaction: Interaction.Model,
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
	interaction: Interaction.init(),
})

/** The current sort, for the parent to order its rows (RA's controlled `sortDescriptor`). */
export const sortOf = (model: Model): Option.Option<SortDescriptor> => model.maybeSort

// MESSAGE

export const Message = defineMessageUnion({
	HoveredRow: { row: Schema.String },
	UnhoveredRow: { row: Schema.String },
	HoveredColumn: { column: Schema.String },
	UnhoveredColumn: { column: Schema.String },
	PressedRow: { row: Schema.String, isSelectable: Schema.Boolean, rowText: Schema.String },
	ClickedColumn: { column: Schema.String },
	FocusedTable: { targetRow: Schema.String },
	FocusedRow: { row: Schema.String },
	FocusedCell: { row: Schema.String, column: Schema.String },
	FocusedColumn: { column: Schema.String },
	BlurredTable: {},
	NavigatedToRow: { row: Schema.String, isSelectable: Schema.Boolean, rowText: Schema.String },
	PressedRowSpace: { row: Schema.String, rowText: Schema.String },
	ToggledAll: { keys: Schema.Array(Schema.String) },
	GotInteractionMessage: { message: Interaction.Message },
	ReleasedKey: {},
	CompletedFocusRow: {},
	CompletedAnnounce: {},
})
export type Message = typeof Message.Type

// COMMAND

export const rowId = (model: Model, row: string) => `${model.id}-row-${row}`
export const cellId = (model: Model, row: string, column: string) => `${model.id}-${row}-${column}`
export const columnId = (model: Model, column: string) => `${model.id}-${column}`

// NOTE: a key press can move focus off the table before this runs; only redirect if it hasn't.
export const FocusRowFromTable = Command.define("FocusRowFromTable", {
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

export const AnnounceTable = Command.define("AnnounceTable", {
	args: { message: Schema.String, timeout: Schema.Number },
	messages: [Message.CompletedAnnounce],
	execute: ({ message, timeout }) =>
		Effect.sync(() => announce(message, timeout)).pipe(Effect.as(Message.CompletedAnnounce())),
})

const SELECTION_TIMEOUT = 7000
/** useTable announces a sort change for 500 ms. */
const SORT_TIMEOUT = 500

const rowTextOf = (message: Message) =>
	message._tag === "PressedRow" || message._tag === "NavigatedToRow" || message._tag === "PressedRowSpace"
		? Option.some({ row: message.row, text: message.rowText })
		: Option.none()

const sortDescription = (model: Model) =>
	Option.map(model.maybeSort, (sort) => `sorted by column  in ${sort.direction} order`)

/**
 * useTable's live announcements: useGridSelectionAnnouncement on a selection change and the sort
 * description. Legacy's columns render through a function, so the column name is always empty.
 */
const announcementsFor = (previous: Model, next: Model, message: Message) => {
	const selection =
		previous.selectedKeys === next.selectedKeys
			? ""
			: gridSelectionMessage({
					previous: previous.selectedKeys,
					next:
						message._tag === "ToggledAll" && next.selectedKeys.length > 0
							? "all"
							: next.selectedKeys,
					isReplace: next.selectionMode === "single",
					isMultiple: next.selectionMode === "multiple",
					rowText: (key) =>
						Option.match(rowTextOf(message), {
							onNone: () => "",
							onSome: ({ row, text }) => (row === key ? text : ""),
						}),
				})
	// useUpdateEffect on the description string: with no column name, only a direction change shows.
	const sort = Option.filter(
		sortDescription(next),
		(description) => !Option.contains(sortDescription(previous), description),
	)
	return [
		...(selection === "" ? [] : [AnnounceTable({ message: selection, timeout: SELECTION_TIMEOUT })]),
		...Option.toArray(Option.map(sort, (message) => AnnounceTable({ message, timeout: SORT_TIMEOUT }))),
	]
}

// UPDATE

const withFocus = (model: Model, focus: Focus) => modifyFields(model, { focus: () => focus })
const withModality = (model: Model, modality: Collection.Modality) =>
	modifyFields(model, { modality: () => modality })

/** Replace behavior selects the row; toggle behavior (multiple) flips it. */
const selectRow = (model: Model, row: string, isSelectable: boolean) =>
	!isSelectable
		? model
		: model.selectionMode === "single"
			? modifyFields(model, { selectedKeys: () => [row] })
			: model.selectionMode === "multiple"
				? modifyFields(model, {
						selectedKeys: (keys) =>
							keys.includes(row) ? keys.filter((key) => key !== row) : [...keys, row],
					})
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

export const update = (model: Model, message: Message): Update.Return<Model, Message> => {
	const result = updateTable(model, message)
	const announcements = announcementsFor(model, result.model, message)
	return announcements.length === 0
		? result
		: { ...result, commands: [...(result.commands ?? []), ...announcements] }
}

const updateTable = (model: Model, message: Message) =>
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
		// Toggle behavior moves focus without selecting; Space toggles instead.
		NavigatedToRow: ({ row, isSelectable }) => ({
			model:
				model.selectionMode === "multiple"
					? withModality(model, "Keyboard")
					: selectRow(withModality(model, "Keyboard"), row, isSelectable),
		}),
		PressedRowSpace: ({ row }) => ({ model: selectRow(withModality(model, "Keyboard"), row, true) }),
		// The header checkbox: select every enabled row, or clear them all once they are.
		ToggledAll: ({ keys }) => ({
			model: modifyFields(model, {
				selectedKeys: (selected) => (keys.every((key) => selected.includes(key)) ? [] : [...keys]),
			}),
		}),
		ReleasedKey: () => ({ model: withModality(model, "Keyboard") }),
		GotInteractionMessage: ({ message: child }) => ({
			model: modifyFields(model, {
				interaction: () => Interaction.update(model.interaction, child).model,
			}),
		}),
		CompletedFocusRow: () => ({ model }),
		CompletedAnnounce: () => ({ model }),
	})

// SUBSCRIPTION

/** Modality tracking for the selection checkboxes (lift it where checkboxes are shown). */
export const subscriptions = Subscription.lift(Interaction.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.interaction),
	toParentMessage: (message) => Message.GotInteractionMessage({ message }),
})

/** The utility column holding "Select All". */
export const SELECTION_COLUMN = "__selection"
