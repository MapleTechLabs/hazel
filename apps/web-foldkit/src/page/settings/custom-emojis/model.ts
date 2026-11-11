import { CustomEmojiId } from "@hazel/schema"
import { Schema } from "effect"
import { Field } from "foldkit/fieldValidation"
import { File } from "foldkit/file"
import { CommonReason } from "~/lib/error-messages"
import * as ConfirmAction from "../../shared/confirm-action"
import * as DropZone from "../../shared/drop-zone"
import { UploadProblem } from "../upload"

export const Emoji = Schema.Struct({
	id: CustomEmojiId,
	name: Schema.String,
	imageUrl: Schema.String,
	createdAtMs: Schema.NullOr(Schema.Number),
	creatorFirstName: Schema.String,
	creatorLastName: Schema.String,
})
export type Emoji = typeof Emoji.Type

/** The upload zone's selected file, its object-URL preview and the name being edited. */
export const Draft = Schema.Struct({
	file: File,
	previewUrl: Schema.String,
	name: Field(Schema.String),
})
export type Draft = typeof Draft.Type

export const DeleteTarget = Schema.Struct({ id: CustomEmojiId, name: Schema.String })
export type DeleteTarget = typeof DeleteTarget.Type

export const RestoreTarget = Schema.Struct({
	id: CustomEmojiId,
	name: Schema.String,
	imageUrl: Schema.String,
	newImageUrl: Schema.String,
})
export type RestoreTarget = typeof RestoreTarget.Type

/** Why creating failed: the upload's problems, an active emoji already has the name, or a shared reason. */
export const CreateFailure = Schema.Union([UploadProblem, Schema.Literal("NameTaken"), CommonReason])
export type CreateFailure = typeof CreateFailure.Type

/** Why restoring failed, beyond the shared reasons. */
export const RestoreFailure = Schema.Union([Schema.Literals(["NotFound", "NameTaken"]), CommonReason])
export type RestoreFailure = typeof RestoreFailure.Type

/** Why deleting failed, beyond the shared reasons. */
export const DeleteFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type DeleteFailure = typeof DeleteFailure.Type

export const Model = Schema.Struct({
	/** `null` while the live query loads (the legacy skeleton table). */
	emojis: Schema.NullOr(Schema.Array(Emoji)),
	draft: Schema.NullOr(Draft),
	/** The draft's upload and create are running. */
	isCreating: Schema.Boolean,
	dropZone: DropZone.Model,
	deleteConfirm: ConfirmAction.Model(DeleteTarget),
	/** Asked when the draft's name belongs to a deleted emoji. */
	restoreConfirm: ConfirmAction.Model(RestoreTarget),
})
export type Model = typeof Model.Type
