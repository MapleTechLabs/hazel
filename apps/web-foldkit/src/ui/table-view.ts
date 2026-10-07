import { Array, Option } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { defineView } from "foldkit/submodel"
import { twJoin, twMerge } from "tailwind-merge"
import { tableStyles } from "~/components/ui/table.styles"
import { IconChevronDown } from "../icons"
import * as Collection from "./aria/collection"
import * as Interaction from "./aria/interaction"
import { checkbox } from "./checkbox"
import { cellId, columnId, Message, type Model, rowId, SELECTION_COLUMN } from "./table"

export interface TableColumn {
	readonly key: string
	readonly content: string
	readonly isRowHeader?: boolean
	readonly allowsSorting?: boolean
}

export interface TableRow {
	readonly key: string
	readonly cells: ReadonlyArray<Html | string>
	readonly isDisabled?: boolean
}

export type ViewInputs = Readonly<{
	label: string
	columns: ReadonlyArray<TableColumn>
	rows: ReadonlyArray<TableRow>
	emptyState?: ReadonlyArray<Html | string>
	className?: string
	bleed?: boolean
	grid?: boolean
	striped?: boolean
}>

const rac = <Message>(h: HtmlBuilder<Message>, slot?: string): ReadonlyArray<Attribute<Message>> => [
	h.Attribute("data-rac", ""),
	...(slot === undefined ? [] : [h.Attribute("data-slot", slot)]),
]

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const { focus, modality } = model
	const { columns, rows, bleed, grid, striped } = viewInputs
	const isSelectable = model.selectionMode !== "none"
	const isMultiple = model.selectionMode === "multiple"
	const columnOffset = isMultiple ? 1 : 0
	const wiring: Interaction.Wiring<Message> = {
		model: model.interaction,
		toParentMessage: (message) => Message.GotInteractionMessage({ message }),
	}
	const hasRows = Array.isReadonlyArrayNonEmpty(rows)
	const isVisible = modality !== "Pointer"
	const isFocusWithin = focus._tag !== "Outside"
	const enabledRows = Array.filter(rows, (row) => row.isDisabled !== true)
	const rowKeys = Array.map(rows, (row) => row.key)
	const isDisabledRow = (key: string) => !Array.some(enabledRows, (row) => row.key === key)
	const firstColumnKey = Option.getOrElse(
		Option.map(Array.head(columns), (column) => column.key),
		() => "",
	)
	const firstEnabledRow = Option.map(Array.head(enabledRows), (row) => row.key)
	const tableFocusTarget = Option.orElse(
		Array.findFirst(model.selectedKeys, (key) => !isDisabledRow(key)),
		() => firstEnabledRow,
	)

	const verticalTarget = (fromRow: string, keyboardKey: string) =>
		Option.flatMap(Collection.directionOfKey("vertical", keyboardKey), (direction) =>
			Collection.moveKey(rowKeys, fromRow, direction, isDisabledRow, false),
		)

	const rowNavigation = (fromRow: string) => (keyboardKey: string) =>
		isMultiple && keyboardKey === " "
			? Option.some({
					focusSelector: Collection.idSelector(rowId(model, fromRow)),
					message: Message.PressedRowSpace({ row: fromRow }),
				})
			: Option.map(verticalTarget(fromRow, keyboardKey), (row) => ({
					focusSelector: Collection.idSelector(rowId(model, row)),
					message: Message.NavigatedToRow({ row, isSelectable }),
				}))

	// NOTE: keydown bubbles from rows and cells (which may already have moved focus), so this reads the
	// live focus: it only acts while the table element itself is focused, before RA-style redirection.
	const tableNavigation = (targetRow: string) => (keyboardKey: string) =>
		document.activeElement?.id === model.id ? rowNavigation(targetRow)(keyboardKey) : Option.none()

	const cellNavigation = (fromRow: string, fromColumn: string) => (keyboardKey: string) => {
		const columnKeys = Array.map(columns, (column) => column.key)
		const maybeColumn = Option.flatMap(
			Collection.directionOfKey("horizontal", keyboardKey),
			(direction) =>
				direction === "Next" || direction === "Previous"
					? Collection.moveKey(columnKeys, fromColumn, direction, () => false, false)
					: Option.none(),
		)
		const maybeTarget = Option.orElse(
			Option.map(maybeColumn, (column) => ({ row: fromRow, column })),
			() => Option.map(verticalTarget(fromRow, keyboardKey), (row) => ({ row, column: fromColumn })),
		)
		return Option.map(maybeTarget, ({ row, column }) => ({
			focusSelector: Collection.idSelector(cellId(model, row, column)),
			message: Message.NavigatedToRow({ row, isSelectable }),
		}))
	}

	const columnView = (column: TableColumn, index: number): Html => {
		const isHovered = Option.contains(model.maybeHoveredColumn, column.key)
		const isFocused = focus._tag === "Column" && focus.column === column.key
		const maybeDirection = Option.flatMap(model.maybeSort, (sort) =>
			sort.column === column.key ? Option.some(sort.direction) : Option.none(),
		)
		const sortDirection = Option.getOrUndefined(maybeDirection)
		const sortIconClass = tableStyles.sortIcon(sortDirection)
		return h.keyed("th")(
			column.key,
			[
				h.Class(twMerge(twMerge(tableStyles.column({ bleed, grid, isResizable: false })))),
				h.Id(columnId(model, column.key)),
				h.Role("columnheader"),
				h.Attribute("aria-colindex", String(index + 1 + columnOffset)),
				...(column.allowsSorting ? [h.Attribute("aria-sort", sortDirection ?? "none")] : []),
				...(column.allowsSorting ? [h.Attribute("data-allows-sorting", "true")] : []),
				...(sortDirection === undefined ? [] : [h.Attribute("data-sort-direction", sortDirection)]),
				h.Attribute("data-collection", model.id),
				h.Attribute("data-key", column.key),
				...rac(h, "table-column"),
				h.Attribute("data-react-aria-pressable", "true"),
				h.Tabindex(isFocused ? 0 : -1),
				...Collection.stateAttributes(h, {
					isHovered,
					isFocused,
					isFocusVisible: isFocused && isVisible,
				}),
				h.OnMouseEnter(Message.HoveredColumn({ column: column.key })),
				h.OnMouseLeave(Message.UnhoveredColumn({ column: column.key })),
				h.OnFocus(Message.FocusedColumn({ column: column.key })),
				h.OnBlur(Message.BlurredTable()),
				...(column.allowsSorting ? [h.OnClick(Message.ClickedColumn({ column: column.key }))] : []),
			],
			[
				h.div(
					[h.Class(twJoin(tableStyles.columnContent))],
					[
						column.content,
						...(column.allowsSorting
							? [
									h.span(
										[h.Class(twJoin(...tableStyles.sortIndicator(isHovered)))],
										[
											IconChevronDown(
												h,
												sortIconClass
													? { className: sortIconClass }
													: { attributes: { class: "" } },
											),
										],
									),
								]
							: []),
					],
				),
			],
		)
	}

	const cellClass = twMerge(
		twMerge(twJoin(...tableStyles.cell({ allowResize: false, bleed, grid, striped }))),
	)

	const rowHeaderKey = Option.getOrElse(
		Option.map(
			Array.findFirst(columns, (column) => column.isRowHeader === true),
			(column) => column.key,
		),
		() => firstColumnKey,
	)

	/** TableRow's leading cell with `<Checkbox slot="selection" />`; the row's press toggles it. */
	const selectionCell = (row: TableRow, isSelected: boolean, isDisabled: boolean): Html => {
		const checkboxId = `${rowId(model, row.key)}-select`
		return h.keyed("td")(
			SELECTION_COLUMN,
			[
				h.Class(
					twMerge(
						twMerge(twJoin(...tableStyles.cell({ allowResize: false, bleed, grid, striped }))),
						tableStyles.dragCell,
					),
				),
				h.Id(cellId(model, row.key, SELECTION_COLUMN)),
				h.Role("gridcell"),
				h.Attribute("data-collection", model.id),
				h.Attribute("data-column-index", "0"),
				h.Attribute("data-key", `${row.key}-${SELECTION_COLUMN}`),
				...rac(h, "table-cell"),
				h.Tabindex(-1),
				...Collection.stateAttributes(h, { isSelected }),
			],
			[
				checkbox(
					h,
					{
						id: checkboxId,
						isSelected,
						isDisabled,
						slot: "selection",
						ariaLabel: "Select",
						labelledBy: `${checkboxId} ${cellId(model, row.key, rowHeaderKey)}`,
						interaction: wiring,
					},
					[],
				),
			],
		)
	}

	const enabledKeys = Array.map(enabledRows, (row) => row.key)
	const selectedEnabled = Array.filter(enabledKeys, (key) => model.selectedKeys.includes(key))
	const isAllSelected = enabledKeys.length > 0 && selectedEnabled.length === enabledKeys.length
	const selectionColumn = h.keyed("th")(
		SELECTION_COLUMN,
		[
			h.Class(twMerge(...tableStyles.utilityColumn(bleed))),
			h.Id(columnId(model, SELECTION_COLUMN)),
			h.Role("columnheader"),
			h.Attribute("aria-colindex", "1"),
			h.Attribute("data-collection", model.id),
			h.Attribute("data-key", SELECTION_COLUMN),
			...rac(h, "table-column"),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Tabindex(focus._tag === "Column" && focus.column === SELECTION_COLUMN ? 0 : -1),
			h.OnFocusEnter(Message.FocusedColumn({ column: SELECTION_COLUMN })),
		],
		[
			checkbox(
				h,
				{
					id: `${model.id}-select-all`,
					isSelected: isAllSelected,
					isIndeterminate: !isAllSelected && selectedEnabled.length > 0,
					slot: "selection",
					ariaLabel: "Select All",
					interaction: wiring,
					onChange: () => Message.ToggledAll({ keys: enabledKeys }),
				},
				[],
			),
		],
	)

	const rowView = (row: TableRow): Html => {
		const isDisabled = row.isDisabled === true
		const isSelected = isSelectable && model.selectedKeys.includes(row.key)
		const isRowFocused = focus._tag === "Row" && focus.row === row.key
		const isWithin = (focus._tag === "Row" || focus._tag === "Cell") && focus.row === row.key
		const isPressable = isSelectable && !isDisabled
		const rowClass = twMerge(
			...tableStyles.row({
				isSelected,
				isFocusVisible: isRowFocused && isVisible,
				isFocusVisibleWithin: isWithin && isVisible,
				isDragging: false,
				isDisabled,
				isActionable: isMultiple,
				striped,
			}),
		)
		const cellView = (cell: Html | string, index: number): Html => {
			const column = Array.get(columns, index)
			const columnKey = Option.getOrElse(
				Option.map(column, (it) => it.key),
				() => String(index),
			)
			const isRowHeader = Option.exists(column, (it) => it.isRowHeader === true)
			const isFocused = focus._tag === "Cell" && focus.row === row.key && focus.column === columnKey
			return h.keyed("td")(
				columnKey,
				[
					h.Class(cellClass),
					h.Id(cellId(model, row.key, columnKey)),
					h.Role(isRowHeader ? "rowheader" : "gridcell"),
					h.Attribute("data-collection", model.id),
					h.Attribute("data-column-index", String(index + columnOffset)),
					h.Attribute("data-key", `${row.key}-${columnKey}`),
					...rac(h, "table-cell"),
					h.Tabindex(isFocused ? 0 : -1),
					...Collection.stateAttributes(h, {
						isFocused,
						isFocusVisible: isFocused && isVisible,
						isSelected,
					}),
					h.OnFocus(Message.FocusedCell({ row: row.key, column: columnKey })),
					h.OnBlur(Message.BlurredTable()),
					h.OnKeyDownFocus(cellNavigation(row.key, columnKey)),
				],
				[cell],
			)
		}
		const interactive: ReadonlyArray<Attribute<Message>> = isDisabled
			? [h.AriaDisabled(true)]
			: [
					h.Tabindex(isRowFocused ? 0 : -1),
					h.OnFocus(Message.FocusedRow({ row: row.key })),
					h.OnBlur(Message.BlurredTable()),
					h.OnKeyDownFocus((keyboardKey) =>
						document.activeElement?.id === rowId(model, row.key)
							? rowNavigation(row.key)(keyboardKey)
							: Option.none(),
					),
					h.OnPointerDown(() => Option.some(Message.PressedRow({ row: row.key, isSelectable }))),
					h.OnMouseEnter(Message.HoveredRow({ row: row.key })),
					h.OnMouseLeave(Message.UnhoveredRow({ row: row.key })),
				]
		return h.keyed("tr")(
			row.key,
			[
				h.Class(rowClass),
				h.Id(rowId(model, row.key)),
				h.Role("row"),
				h.AriaLabelledBy(cellId(model, row.key, firstColumnKey)),
				...(isSelectable
					? [h.AriaSelected(isSelected), h.Attribute("data-selection-mode", model.selectionMode)]
					: []),
				h.Attribute("data-collection", model.id),
				h.Attribute("data-key", row.key),
				...rac(h, "table-row"),
				...(isPressable ? [h.Attribute("data-react-aria-pressable", "true")] : []),
				...Collection.stateAttributes(h, {
					isHovered: isPressable && Option.contains(model.maybeHoveredRow, row.key),
					isFocused: isRowFocused,
					isFocusVisible: isRowFocused && isVisible,
					isSelected,
					isDisabled,
				}),
				...(isWithin && isVisible ? [h.DataAttribute("focus-visible-within", "true")] : []),
				...interactive,
			],
			[
				...(isMultiple ? [selectionCell(row, isSelected, isDisabled)] : []),
				...Array.map(row.cells, cellView),
			],
		)
	}

	const emptyRow = h.tr(
		[h.Role("row")],
		[
			h.td(
				[h.Attribute("colspan", String(columns.length)), h.Role("rowheader")],
				[...(viewInputs.emptyState ?? [])],
			),
		],
	)

	const table = h.table(
		[
			h.Class(tableStyles.root),
			h.Id(model.id),
			h.Role("grid"),
			h.AriaLabel(viewInputs.label),
			h.Attribute("aria-describedby", ""),
			...(hasRows ? [h.Attribute("data-collection", model.id)] : []),
			h.Attribute("data-rac", ""),
			h.Tabindex(isFocusWithin ? -1 : 0),
			...Option.match(tableFocusTarget, {
				onNone: () => [],
				onSome: (targetRow) => [
					h.OnFocus(Message.FocusedTable({ targetRow })),
					h.OnKeyDownFocus(tableNavigation(targetRow)),
				],
			}),
			h.OnKeyUp(() => Message.ReleasedKey()),
		],
		[
			h.thead(
				[
					h.Class(twMerge(twMerge(tableStyles.header))),
					...rac(h, "table-header"),
					h.Role("rowgroup"),
					...Collection.stateAttributes(h, { isHovered: Option.isSome(model.maybeHoveredColumn) }),
				],
				[
					h.tr(
						[h.Role("row")],
						[...(isMultiple ? [selectionColumn] : []), ...Array.map(columns, columnView)],
					),
				],
			),
			h.tbody(
				[
					h.Class("react-aria-TableBody"),
					...(hasRows ? [] : [h.DataAttribute("empty", "true")]),
					...rac(h, "table-body"),
					h.Role("rowgroup"),
				],
				hasRows ? Array.map(rows, rowView) : [emptyRow],
			),
		],
	)

	const focusScope = (edge: "start" | "end") =>
		h.span([h.Attribute(`data-focus-scope-${edge}`, "true"), h.Attribute("hidden", "")])

	return h.div(
		[h.Class("flow-root")],
		[
			h.div(
				[h.Class(twMerge(tableStyles.scroller, viewInputs.className))],
				[
					h.div(
						[h.Class(twJoin(...tableStyles.inner(bleed)))],
						[focusScope("start"), table, focusScope("end")],
					),
				],
			),
		],
	)
})
