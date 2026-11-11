import { Option, Schema, Stream } from "effect"
import { Dom, type Update } from "foldkit"
import type { File } from "foldkit/file"
import type { Attribute, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

/**
 * A file drop target (React Aria `DropZone`): whether a drag is over the zone, and optionally how many file
 * drags are over the page (legacy `useDragDetection`, for a "Drop image" hint). The dropped files go to the
 * parent's own Message; call `reset` when it handles them.
 */

// MODEL

export const Model = Schema.Struct({
	isOver: Schema.Boolean,
	/** Nested `dragenter`/`dragleave` depth of file drags anywhere on the page. */
	pageDragDepth: Schema.Number,
})
export type Model = typeof Model.Type

export const init = (): Model => ({ isOver: false, pageDragDepth: 0 })

/** After a drop (or a cancelled drag): nothing hovers. */
export const reset = (): Model => init()

export const isDraggingOnPage = (model: Model): boolean => model.pageDragDepth > 0

// MESSAGE

export const Message = defineMessageUnion({
	EnteredZone: {},
	LeftZone: {},
	DraggedFilesOverPage: { isEntering: Schema.Boolean },
	EndedPageDrag: {},
})
export type Message = typeof Message.Type

// UPDATE

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		EnteredZone: () => ({ model: { ...model, isOver: true } }),
		LeftZone: () => ({ model: { ...model, isOver: false } }),
		DraggedFilesOverPage: ({ isEntering }) => ({
			model: { ...model, pageDragDepth: Math.max(0, model.pageDragDepth + (isEntering ? 1 : -1)) },
		}),
		EndedPageDrag: () => ({ model: reset() }),
	})

// VIEW

/** The zone's drag handlers and `data-drop-target`; `onDrop` is the parent's file Message. */
export const zoneAttributes = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	toParentMessage: (message: Message) => ParentMessage,
	onDrop: (files: ReadonlyArray<File>) => ParentMessage,
): ReadonlyArray<Attribute<ParentMessage>> => [
	...(model.isOver ? [h.DataAttribute("drop-target", "true")] : []),
	h.AllowDrop(),
	h.OnDragEnter(toParentMessage(Message.EnteredZone())),
	h.OnDragLeave(toParentMessage(Message.LeftZone())),
	h.OnDragOver(toParentMessage(Message.EnteredZone())),
	h.OnDropFiles((files) => onDrop(files)),
]

// SUBSCRIPTIONS

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false

/**
 * `useDragDetection`: file drags anywhere on the page, for zones that hint before the drag reaches them.
 * The parent runs it as a `Subscription.persistentEntry`.
 */
export const pageDragStream = <ParentMessage>(toParentMessage: (message: Message) => ParentMessage) =>
	Stream.mergeAll(
		[
			Dom.streamFromEventFilterMap({
				target: document,
				type: "dragenter",
				filterMapEvent: (event) =>
					hasFiles(event)
						? Option.some(toParentMessage(Message.DraggedFilesOverPage({ isEntering: true })))
						: Option.none(),
			}),
			Dom.streamFromEvent({
				target: document,
				type: "dragleave",
				mapEvent: () => toParentMessage(Message.DraggedFilesOverPage({ isEntering: false })),
			}),
			Dom.streamFromEvent({
				target: document,
				type: "drop",
				mapEvent: () => toParentMessage(Message.EndedPageDrag()),
			}),
			Dom.streamFromEvent({
				target: document,
				type: "dragend",
				mapEvent: () => toParentMessage(Message.EndedPageDrag()),
			}),
		],
		{ concurrency: "unbounded" },
	)
