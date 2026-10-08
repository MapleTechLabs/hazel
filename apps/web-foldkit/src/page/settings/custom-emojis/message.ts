import { CustomEmojiId } from "@hazel/schema"
import { Schema } from "effect"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../overlay/toasts"
import * as Modal from "../../../ui/modal"
import { Emoji, RestoreTarget } from "./model"

export const Message = defineMessageUnion({
	UpdatedEmojis: { emojis: Schema.Array(Emoji) },
	ClickedBrowse: { inputId: Schema.String },
	CompletedOpenPicker: {},
	SelectedFiles: { files: Schema.Array(File) },
	EnteredDropZone: {},
	LeftDropZone: {},
	CreatedPreview: { file: File, previewUrl: Schema.String },
	CompletedFocusName: {},
	ChangedEmojiName: { value: Schema.String },
	ClickedCancelUpload: {},
	CompletedRevokePreview: {},
	ClickedSaveEmoji: {},
	SucceededCreateEmoji: { name: Schema.String, previewUrl: Schema.String },
	FoundDeletedEmoji: { target: RestoreTarget },
	FailedCreateEmoji: { toast: ToastRequest },
	ClickedConfirmRestore: {},
	SucceededRestoreEmoji: { name: Schema.String, previewUrl: Schema.NullOr(Schema.String) },
	FailedRestoreEmoji: {},
	ClickedDeleteEmoji: { id: CustomEmojiId, name: Schema.String },
	ClickedConfirmDelete: {},
	SucceededDeleteEmoji: { name: Schema.String },
	FailedDeleteEmoji: {},
	GotDeleteModalMessage: { message: Modal.Message },
	GotRestoreModalMessage: { message: Modal.Message },
})
export type Message = typeof Message.Type
