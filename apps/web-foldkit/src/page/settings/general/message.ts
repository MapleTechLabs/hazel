import { Schema } from "effect"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import * as ConfirmAction from "../../shared/confirm-action"
import {
	CopyTarget,
	DeleteWorkspaceFailure,
	RenameFailure,
	SetPublicModeFailure,
	UploadLogoFailure,
} from "./model"

export const Message = defineMessageUnion({
	ResolvedOrigin: { origin: Schema.String },
	UpdatedIsPublic: { isPublic: Schema.Boolean },
	ChangedName: { value: Schema.String },
	SubmittedName: {},
	ClickedCancelName: {},
	SucceededUpdateName: {},
	FailedUpdateName: { reason: RenameFailure },
	ClickedLogo: {},
	CompletedOpenLogoPicker: {},
	SelectedLogo: { files: Schema.Array(File) },
	SucceededUploadLogo: {},
	FailedUploadLogo: { reason: UploadLogoFailure },
	ToggledPublicMode: { isPublic: Schema.Boolean },
	SucceededSetPublicMode: { isPublic: Schema.Boolean },
	FailedSetPublicMode: { reason: SetPublicModeFailure },
	ClickedCopy: { target: CopyTarget, text: Schema.String },
	SucceededCopy: { target: CopyTarget },
	FailedCopy: { target: CopyTarget, reason: Schema.Literal("ClipboardDenied") },
	ClickedDeleteWorkspace: {},
	GotDeleteConfirmMessage: { message: ConfirmAction.Message },
	ChangedConfirmation: { value: Schema.String },
	ClickedCancelDelete: {},
	ClickedConfirmDelete: {},
	SucceededDeleteWorkspace: {},
	FailedDeleteWorkspace: { reason: DeleteWorkspaceFailure },
})
export type Message = typeof Message.Type
