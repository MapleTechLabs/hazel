import { CustomEmojiId } from "@hazel/schema"
import { Schema } from "effect"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import * as ConfirmAction from "../../shared/confirm-action"
import * as DropZone from "../../shared/drop-zone"
import { CreateFailure, DeleteFailure, Emoji, RestoreFailure, RestoreTarget } from "./model"

export const Message = defineMessageUnion({
	UpdatedEmojis: { emojis: Schema.Array(Emoji) },
	ClickedBrowse: { inputId: Schema.String },
	CompletedOpenPicker: {},
	SelectedFiles: { files: Schema.Array(File) },
	GotDropZoneMessage: { message: DropZone.Message },
	CreatedPreview: { file: File, previewUrl: Schema.String },
	CompletedFocusName: {},
	ChangedEmojiName: { value: Schema.String },
	ClickedCancelUpload: {},
	CompletedRevokePreview: {},
	ClickedSaveEmoji: {},
	SucceededCreateEmoji: { name: Schema.String, previewUrl: Schema.String },
	FoundDeletedEmoji: { target: RestoreTarget },
	FailedCreateEmoji: { reason: CreateFailure },
	ClickedConfirmRestore: {},
	SucceededRestoreEmoji: { name: Schema.String, previewUrl: Schema.NullOr(Schema.String) },
	FailedRestoreEmoji: { reason: RestoreFailure },
	ClickedDeleteEmoji: { id: CustomEmojiId, name: Schema.String },
	ClickedConfirmDelete: {},
	SucceededDeleteEmoji: { name: Schema.String },
	FailedDeleteEmoji: { reason: DeleteFailure },
	GotDeleteConfirmMessage: { message: ConfirmAction.Message },
	GotRestoreConfirmMessage: { message: ConfirmAction.Message },
})
export type Message = typeof Message.Type
