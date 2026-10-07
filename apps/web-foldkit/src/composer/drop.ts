import { Effect, Queue, Schema, Stream } from "effect"
import { File, Mount } from "foldkit"
import { defineMessageUnion } from "foldkit/message"

/**
 * `ComposerDropZone`: React Aria's `DropZone` (drop target, accepted types) plus `useDragDetection`
 * (files dragged anywhere on the page), as one Mount on the drop zone element.
 */

/** `getDropOperation`: the concrete types React Aria checks for the wildcard entries. */
const ACCEPTED_TYPES = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"video/mp4",
	"video/webm",
	"video/quicktime",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
	"audio/webm",
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"text/plain",
	"text/csv",
]

export const DropEvent = defineMessageUnion({
	ChangedDragState: { isDraggingOnPage: Schema.Boolean, isDropTarget: Schema.Boolean },
	DroppedFiles: { files: Schema.Array(File.File) },
})
export type DropEvent = typeof DropEvent.Type

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false

const isAccepted = (event: DragEvent) =>
	Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file" && ACCEPTED_TYPES.includes(item.type))

export const TrackFileDrop = Mount.defineStream("TrackFileDrop", {
	args: { isDisabled: Schema.Boolean },
	messages: [DropEvent.ChangedDragState, DropEvent.DroppedFiles],
	execute: ({ element, isDisabled }) =>
		Stream.callback<DropEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					let pageCounter = 0
					let targetCounter = 0
					const emit = () =>
						Queue.offerUnsafe(
							queue,
							DropEvent.ChangedDragState({ isDraggingOnPage: pageCounter > 0, isDropTarget: targetCounter > 0 }),
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
						if (isDisabled || !isAccepted(event)) return
						targetCounter++
						emit()
					}
					const onLeave = () => {
						targetCounter = Math.max(0, targetCounter - 1)
						emit()
					}
					const onOver = (event: DragEvent) => {
						if (!isDisabled && isAccepted(event)) event.preventDefault()
					}
					const onDrop = (event: DragEvent) => {
						if (isDisabled) return
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
