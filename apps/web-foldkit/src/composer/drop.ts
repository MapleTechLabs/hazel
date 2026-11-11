import { Effect, Queue, Schema, Stream } from "effect"
import { File, Mount } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { isAcceptedMimeType } from "../editor/file-types"

/**
 * `ComposerDropZone`: React Aria's `DropZone` (drop target, accepted types) plus `useDragDetection`
 * (files dragged anywhere on the page), as one Mount on the drop zone element. Whether a drop is
 * taken (not while a file uploads) is the update's call: the Mount reports every drop.
 */

/** Files dragged over the page (a subtle overlay) or over the drop zone itself (a strong one). */
export const DragState = defineTaggedUnion({
	Idle: {},
	DraggingOnPage: {},
	OverDropZone: {},
})
export type DragState = typeof DragState.Type

export const DropEvent = defineMessageUnion({
	ChangedDragState: { drag: DragState },
	DroppedFiles: { files: Schema.Array(File.File) },
})
export type DropEvent = typeof DropEvent.Type

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false

const isAccepted = (event: DragEvent) =>
	Array.from(event.dataTransfer?.items ?? []).some(
		(item) => item.kind === "file" && isAcceptedMimeType(item.type),
	)

const dragStateOf = (pageCounter: number, targetCounter: number): DragState =>
	targetCounter > 0
		? DragState.OverDropZone()
		: pageCounter > 0
			? DragState.DraggingOnPage()
			: DragState.Idle()

export const TrackFileDrop = Mount.defineStream("TrackFileDrop", {
	messages: [DropEvent.ChangedDragState, DropEvent.DroppedFiles],
	execute: ({ element }) =>
		Stream.callback<DropEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					let pageCounter = 0
					let targetCounter = 0
					const emit = () =>
						Queue.offerUnsafe(
							queue,
							DropEvent.ChangedDragState({ drag: dragStateOf(pageCounter, targetCounter) }),
						)
					const reset = () => {
						pageCounter = 0
						targetCounter = 0
						emit()
					}
					const onPageEnter = (event: DragEvent) => {
						if (!hasFiles(event)) return
						pageCounter++
						emit()
					}
					const onPageLeave = () => {
						pageCounter = Math.max(0, pageCounter - 1)
						emit()
					}
					const onEnter = (event: DragEvent) => {
						if (!isAccepted(event)) return
						targetCounter++
						emit()
					}
					const onLeave = () => {
						targetCounter = Math.max(0, targetCounter - 1)
						emit()
					}
					// `preventDefault` has to happen in the listener for the element to accept the drop.
					const onOver = (event: DragEvent) => {
						if (isAccepted(event)) event.preventDefault()
					}
					const onDrop = (event: DragEvent) => {
						event.preventDefault()
						const files = Array.from(event.dataTransfer?.files ?? [])
						reset()
						if (files.length > 0) Queue.offerUnsafe(queue, DropEvent.DroppedFiles({ files }))
					}
					document.addEventListener("dragenter", onPageEnter)
					document.addEventListener("dragleave", onPageLeave)
					document.addEventListener("drop", reset)
					document.addEventListener("dragend", reset)
					element.addEventListener("dragenter", onEnter as EventListener)
					element.addEventListener("dragleave", onLeave)
					element.addEventListener("dragover", onOver as EventListener)
					element.addEventListener("drop", onDrop as EventListener)
					return () => {
						document.removeEventListener("dragenter", onPageEnter)
						document.removeEventListener("dragleave", onPageLeave)
						document.removeEventListener("drop", reset)
						document.removeEventListener("dragend", reset)
						element.removeEventListener("dragenter", onEnter as EventListener)
						element.removeEventListener("dragleave", onLeave)
						element.removeEventListener("dragover", onOver as EventListener)
						element.removeEventListener("drop", onDrop as EventListener)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
})
