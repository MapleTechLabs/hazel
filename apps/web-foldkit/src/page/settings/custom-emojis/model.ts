import { CustomEmojiId } from "@hazel/schema"
import { Schema } from "effect"
import { File } from "foldkit/file"
import * as Modal from "../../../ui/modal"

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
	name: Schema.String,
	nameError: Schema.NullOr(Schema.String),
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

export const Model = Schema.Struct({
	/** `null` while the live query loads (the legacy skeleton table). */
	emojis: Schema.NullOr(Schema.Array(Emoji)),
	draft: Schema.NullOr(Draft),
	isSaving: Schema.Boolean,
	isDropTarget: Schema.Boolean,
	deleteTarget: Schema.NullOr(DeleteTarget),
	restoreTarget: Schema.NullOr(RestoreTarget),
	deleteModal: Modal.Model,
	restoreModal: Modal.Model,
})
export type Model = typeof Model.Type
