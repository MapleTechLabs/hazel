import { Schema } from "effect"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as ComboBox from "../../../ui/combo-box"
import * as Modal from "../../../ui/modal"
import * as DropZone from "../../shared/drop-zone"
import { UploadProblem } from "../../settings/upload"
import { UpdateUserFailure, UserRow } from "../user"
import { CropFailure, CropImage, DragMode } from "./crop"
import { FormValues } from "./model"

/** Why the avatar did not change: the upload failed, or `user.update` did. */
export const UploadAvatarFailure = Schema.Union([UploadProblem, UpdateUserFailure])
export type UploadAvatarFailure = typeof UploadAvatarFailure.Type

export const Message = defineMessageUnion({
	UpdatedUserRow: { row: Schema.NullOr(UserRow) },
	DetectedBrowserTimezone: { browserTimezone: Schema.String },
	ChangedFirstName: { value: Schema.String },
	ChangedLastName: { value: Schema.String },
	GotTimezoneMessage: { message: ComboBox.Message },
	SubmittedProfile: {},
	/** `values` are the saved ones, the form's new defaults. */
	SucceededSaveProfile: { values: FormValues },
	FailedSaveProfile: { reason: UpdateUserFailure },
	ClickedAvatar: {},
	CompletedOpenFilePicker: {},
	SelectedAvatarFiles: { files: Schema.Array(File) },
	LoadedCropImage: { loadId: Schema.Number, image: CropImage },
	FailedLoadCropImage: { loadId: Schema.Number, reason: CropFailure },
	CompletedRevokeCropImage: {},
	GotDropZoneMessage: { message: DropZone.Message },
	PressedCropHandle: { mode: DragMode, clientX: Schema.Number, clientY: Schema.Number },
	MovedCropPointer: { clientX: Schema.Number, clientY: Schema.Number },
	ReleasedCropPointer: {},
	ClickedCancelCrop: {},
	ClickedSaveCrop: {},
	SucceededCropImage: { blob: Schema.instanceOf(Blob) },
	FailedCropImage: { reason: CropFailure },
	SucceededUploadAvatar: {},
	FailedUploadAvatar: { reason: UploadAvatarFailure },
	ClickedResetAvatar: {},
	SucceededResetAvatar: {},
	FailedResetAvatar: { reason: UpdateUserFailure },
	GotCropModalMessage: { message: Modal.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
