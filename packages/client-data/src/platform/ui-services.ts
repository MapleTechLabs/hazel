/**
 * UI platform services (`docs/hazel-ui.md`, "Platform services"): host behaviour a shared screen asks
 * for through a Command, not vocabulary. Declarations only (phase 1.5); lane F writes the web and
 * Swift implementations, and a screen's `Command.Service` layer reaches them.
 */
import { AttachmentId } from "@hazel/schema"
import { Context, type Effect, Schema } from "effect"

/** What a pick may return: any file, or images and videos only (the logo upload). */
export const PickAccept = Schema.Literals(["any", "media"])
export type PickAccept = typeof PickAccept.Type

/** A file the host picked or received and uploaded natively: files never cross the wire as data. */
export const PickedFile = Schema.Struct({
	attachmentId: AttachmentId,
	name: Schema.String,
	kind: Schema.Literals(["image", "video", "file"]),
	/** Bytes. */
	size: Schema.Finite,
	width: Schema.optional(Schema.Finite),
	height: Schema.optional(Schema.Finite),
})
export type PickedFile = typeof PickedFile.Type

export class FilesError extends Schema.TaggedError<FilesError>()("FilesError", {
	reason: Schema.Literals(["denied", "tooLarge", "uploadFailed"]),
}) {}

/**
 * `pick` opens the platform's picker (`file-picker`); a cancelled pick succeeds with no files.
 * `dropped` takes the files of the composer's last `files` event (`file-drop`): the host holds them.
 */
export class Files extends Context.Service<
	Files,
	{
		readonly pick: (options: {
			readonly accept: PickAccept
			readonly multiple: boolean
		}) => Effect.Effect<ReadonlyArray<PickedFile>, FilesError>
		readonly dropped: Effect.Effect<ReadonlyArray<PickedFile>, FilesError>
	}
>()("@hazel/client-data/Files") {}

export class ClipboardError extends Schema.TaggedError<ClipboardError>()("ClipboardError", {
	reason: Schema.Literals(["denied", "unavailable"]),
}) {}

/** Writes plain text to the system clipboard (`clipboard`). */
export class Clipboard extends Context.Service<
	Clipboard,
	{
		readonly write: (text: string) => Effect.Effect<void, ClipboardError>
	}
>()("@hazel/client-data/Clipboard") {}
