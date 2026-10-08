import { Schema } from "effect"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../overlay/toasts"
import * as Modal from "../../../ui/modal"

export const Message = defineMessageUnion({
	GotOrigin: { origin: Schema.String },
	UpdatedIsPublic: { isPublic: Schema.Boolean },
	ChangedName: { value: Schema.String },
	SubmittedName: {},
	ClickedCancelName: {},
	SucceededUpdateName: {},
	FailedUpdateName: { toast: ToastRequest },
	ClickedLogo: {},
	CompletedOpenLogoPicker: {},
	SelectedLogo: { files: Schema.Array(File) },
	SucceededUploadLogo: {},
	FailedUploadLogo: { toast: ToastRequest },
	ToggledPublicMode: { isPublic: Schema.Boolean },
	SucceededSetPublicMode: { isPublic: Schema.Boolean },
	FailedSetPublicMode: { toast: ToastRequest },
	ClickedCopy: { text: Schema.String, successTitle: Schema.String, failureTitle: Schema.String },
	CompletedCopy: { toast: ToastRequest },
	ClickedDeleteWorkspace: {},
	GotDeleteModalMessage: { message: Modal.Message },
	ChangedConfirmation: { value: Schema.String },
	ClickedCancelDelete: {},
	ClickedConfirmDelete: {},
	SucceededDeleteWorkspace: {},
	FailedDeleteWorkspace: { toast: ToastRequest },
})
export type Message = typeof Message.Type
