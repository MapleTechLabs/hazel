import { DragAndDrop } from "@foldkit/ui"
import { Option } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/**
 * Reordering by drag on top of `@foldkit/ui` `DragAndDrop`, for rows that are links or tabs
 * themselves (the sidebar's views, the list's view tabs). The whole row starts a drag with the
 * pointer; Alt+arrow moves the focused row one place. `DragAndDrop`'s own keyboard drag would take
 * Enter and Space, which open the link or select the tab, so it is not used.
 *
 * Drop indexes count the other rows: the dragged row keeps its place (dimmed, out of the hit test)
 * while a line marks where it would land.
 */

export type Orientation = "Horizontal" | "Vertical"

export interface SortableRow<M> {
	readonly drag: DragAndDrop.Model
	readonly containerId: string
	readonly itemId: string
	/** The row's index in the list. */
	readonly index: number
	/** Rows in the list (for the line after the last one). */
	readonly count: number
	readonly orientation: Orientation
	readonly toDragMessage: (message: DragAndDrop.Message) => M
	/** Alt+arrow: one place back (-1) or on (1). */
	readonly onStep: (step: -1 | 1) => M
}

const LEFT_BUTTON = 0

/** The list's container: where drops land. */
export const sortableList = <M>(h: HtmlBuilder<M>, containerId: string): Attribute<M> =>
	h.DataAttribute("droppable-id", containerId)

/** Where the dragged row would land in `containerId`, counting the other rows. */
const dropIndexIn = (drag: DragAndDrop.Model, containerId: string): number | null =>
	Option.match(DragAndDrop.maybeDropTarget(drag), {
		onNone: () => null,
		onSome: (target) => (target.containerId === containerId ? target.index : null),
	})

export const isDraggedRow = (drag: DragAndDrop.Model, itemId: string): boolean =>
	DragAndDrop.isDragging(drag) && Option.getOrNull(DragAndDrop.maybeDraggedItemId(drag)) === itemId

const LINE = {
	Vertical: {
		before: "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:rounded-full before:bg-primary",
		after: "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
	},
	Horizontal: {
		before: "before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
		after: "after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-primary",
	},
} as const

/** The row's index among the others while one is dragged (what drop indexes count). */
const otherIndexOf = (drag: DragAndDrop.Model, index: number): number =>
	drag.dragState._tag === "Dragging" && index > drag.dragState.sourceIndex ? index - 1 : index

/** The row's attributes (the press, Alt+arrow, the hit-test id) and its classes. */
export const sortableRow = <M>(
	h: HtmlBuilder<M>,
	row: SortableRow<M>,
): Readonly<{ attributes: ReadonlyArray<Attribute<M>>; className: string }> => {
	const isDragged = isDraggedRow(row.drag, row.itemId)
	const dropIndex = DragAndDrop.isDragging(row.drag) ? dropIndexIn(row.drag, row.containerId) : null
	const line = LINE[row.orientation]
	const otherIndex = otherIndexOf(row.drag, row.index)
	const lastOther = row.count - 2
	const className = isDragged
		? "pointer-events-none opacity-40"
		: dropIndex === null
			? ""
			: twMerge(
					"relative",
					dropIndex === otherIndex ? line.before : "",
					dropIndex > lastOther && otherIndex === lastOther ? line.after : "",
				)
	const previous = row.orientation === "Vertical" ? "ArrowUp" : "ArrowLeft"
	const next = row.orientation === "Vertical" ? "ArrowDown" : "ArrowRight"
	return {
		className,
		attributes: [
			...(isDragged ? [] : [h.DataAttribute("sortable-id", row.itemId)]),
			// `DragAndDrop.FocusItem` finds the row by it after Alt+arrow re-renders the list.
			h.DataAttribute("draggable-id", row.itemId),
			h.Attribute("draggable", "false"),
			h.OnPointerDown((_pointerType, button, screenX, screenY) =>
				button === LEFT_BUTTON
					? Option.some(
							row.toDragMessage(
								DragAndDrop.Message.PressedDraggable({
									itemId: row.itemId,
									containerId: row.containerId,
									index: row.index,
									screenX,
									screenY,
								}),
							),
						)
					: Option.none(),
			),
			h.OnKeyDownPreventDefault((key, modifiers) =>
				modifiers.altKey && (key === previous || key === next)
					? Option.some(row.onStep(key === previous ? -1 : 1))
					: Option.none(),
			),
		],
	}
}

/** The row under the pointer while dragging; nothing otherwise. */
export const dragGhost = <M>(
	h: HtmlBuilder<M>,
	drag: DragAndDrop.Model,
	content: ReadonlyArray<Html>,
): Html =>
	Option.match(DragAndDrop.ghostStyle(drag), {
		onNone: () => h.empty,
		onSome: (style) =>
			h.div(
				[
					h.Style(style),
					h.AriaHidden(true),
					h.Class(
						"ml-3 mt-2 flex items-center gap-2 rounded-lg bg-overlay px-2.5 py-1.5 font-medium text-overlay-fg text-sm shadow-md ring-1 ring-fg/10",
					),
				],
				[...content],
			),
	})
