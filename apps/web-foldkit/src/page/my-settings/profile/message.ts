import { Schema } from "effect"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as ComboBox from "../../../ui/combo-box"
import * as Modal from "../../../ui/modal"
import { UserRow } from "../user"
import { CropImage, DragMode } from "./crop"

export const Message = defineMessageUnion({
	UpdatedUserRow: { row: Schema.NullOr(UserRow) },
	GotBrowserTimezone: { browserTimezone: Schema.String },
	ChangedFirstName: { value: Schema.String },
	ChangedLastName: { value: Schema.String },
	GotTimezoneMessage: { message: ComboBox.Message },
	SubmittedProfile: {},
	CompletedSaveProfile: { isSaved: Schema.Boolean },
	ClickedAvatar: {},
	CompletedOpenFilePicker: {},
	SelectedAvatarFiles: { files: Schema.Array(File) },
	RejectedAvatarFile: { title: Schema.String, description: Schema.String },
	LoadedCropImage: { loadId: Schema.Number, image: CropImage },
	FailedLoadCropImage: { loadId: Schema.Number },
	CompletedRevokeCropImage: {},
	EnteredDropZone: {},
	LeftDropZone: {},
	DraggedFilesOverPage: { isEntering: Schema.Boolean },
	EndedPageDrag: {},
	PressedCropHandle: { mode: DragMode, clientX: Schema.Number, clientY: Schema.Number },
	MovedCropPointer: { clientX: Schema.Number, clientY: Schema.Number },
	ReleasedCropPointer: {},
	ClickedCancelCrop: {},
	ClickedSaveCrop: {},
	CompletedCropImage: { blob: Schema.NullOr(Schema.instanceOf(Blob)) },
	CompletedUploadAvatar: { isUploaded: Schema.Boolean },
	ClickedResetAvatar: {},
	CompletedResetAvatar: { isReset: Schema.Boolean },
	GotCropModalMessage: { message: Modal.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
