import { Array, Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { detectBrowserTimezone } from "~/utils/timezone"
import * as Interaction from "../../../ui/aria/interaction"
import * as ComboBox from "../../../ui/combo-box"
import * as Modal from "../../../ui/modal"
import * as TimezoneSelect from "../../../ui/timezone-select"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../shared"
import type { UserRow } from "../user"
import {
	CropAvatarImage,
	LoadCropImage,
	OpenFilePicker,
	ResetAvatar,
	RevokeCropImage,
	SaveProfile,
	UploadAvatar,
} from "./command"
import { type CropImage, dragTo } from "./crop"
import { isSaveDisabled } from "./form"
import { Message } from "./message"
import type { CropState, FormValues, Model } from "./model"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)
export const toTimezoneMessage = (message: ComboBox.Message) => Message.GotTimezoneMessage({ message })
export const toCropModalMessage = (message: Modal.Message) => Message.GotCropModalMessage({ message })

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

const toast = (intent: "success" | "error", title: string, description: string | null = null) =>
	PageOutMessage.RequestedToast({ toast: { intent, title, description } })

/** The avatar changed in Clerk: `refreshCurrentUser()` re-reads `user.me`, then the success toast. */
const refreshUser = (title: string) =>
	PageOutMessage.RequestedCurrentUserRefresh({ toast: { intent: "success", title, description: null } })

const merge = (first: Return, second: Return): Return => ({
	model: second.model,
	commands: [...(first.commands ?? []), ...(second.commands ?? [])],
	...(second.outMessage === undefined ? {} : { outMessage: second.outMessage }),
})

/** `<form key={user?.id}>`: a new user starts a fresh form from their values. */
const formFor = (model: Model, shared: Shared, row: UserRow | null): Model => {
	const user = shared.currentUser
	const defaults: FormValues = {
		firstName: user?.firstName || "",
		lastName: user?.lastName || "",
		timezone: row?.timezone || detectBrowserTimezone(),
	}
	return modifyFields(model, {
		userId: () => user?.id ?? null,
		defaults: () => defaults,
		values: () => defaults,
		isDirty: () => false,
		timezone: () =>
			TimezoneSelect.init({ id: "profile-timezone", value: defaults.timezone ?? undefined }),
	})
}

const changed = (model: Model, patch: Partial<FormValues>): Model =>
	modifyFields(model, { values: (values) => ({ ...values, ...patch }), isDirty: () => true })

const cropSrc = (crop: CropState) =>
	crop._tag === "Ready" || crop._tag === "Processing" ? crop.image.src : null

/** Closes the crop modal and releases the image (`handleCropModalOpenChange(false)`). */
const closeCrop = (model: Model): Return => {
	const src = cropSrc(model.crop)
	return {
		model: modifyFields(model, {
			crop: () => ({ _tag: "Idle" }),
			cropModal: (modal) => ({ ...modal, isOpen: false }),
		}),
		commands: src === null ? [] : [RevokeCropImage({ src })],
	}
}

/** Applies `f` to the crop image while it is ready for editing. */
const mapReadyImage = (model: Model, f: (image: CropImage) => CropImage): Model => {
	const crop = model.crop
	return crop._tag === "Ready"
		? modifyFields(model, { crop: () => ({ _tag: "Ready", image: f(crop.image) }) })
		: model
}

export const init = (_route: unknown, shared: Shared): Return => ({
	model: formFor(
		{
			userId: null,
			defaults: { firstName: "", lastName: "", timezone: null },
			values: { firstName: "", lastName: "", timezone: null },
			isDirty: false,
			isSubmitting: false,
			timezone: TimezoneSelect.init({ id: "profile-timezone" }),
			isUploading: false,
			isResetting: false,
			isDropTarget: false,
			dragDepth: 0,
			crop: { _tag: "Idle" },
			cropModal: Modal.init("avatar-crop"),
			interaction: Interaction.init(),
		},
		shared,
		null,
	),
})

export const sharedChanged = (model: Model, shared: Shared): Return =>
	(shared.currentUser?.id ?? null) === model.userId ? { model } : { model: formFor(model, shared, null) }

const selectFile = (model: Model, files: ReadonlyArray<File>): Return =>
	Option.match(Array.head(files), {
		onNone: () => ({ model }),
		onSome: (file) => {
			if (!ALLOWED_TYPES.includes(file.type))
				return {
					model,
					outMessage: toast(
						"error",
						"Invalid file type",
						"Please select a JPEG, PNG, or WebP image",
					),
				}
			if (file.size > MAX_FILE_SIZE)
				return { model, outMessage: toast("error", "File too large", "Image must be less than 5MB") }
			return {
				model: modifyFields(model, {
					crop: () => ({ _tag: "Loading" }),
					cropModal: (modal) => ({ ...modal, isOpen: true }),
				}),
				commands: [LoadCropImage({ file })],
			}
		},
	})

const foldCropModal = (model: Model, message: Modal.Message): Return => {
	const result = Modal.update(model.cropModal, message)
	const next = modifyFields(model, { cropModal: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], toCropModalMessage)
	return model.cropModal.isOpen && !result.model.isOpen
		? merge({ model: next, commands }, closeCrop(next))
		: { model: next, commands }
}

const foldTimezone = (model: Model, message: ComboBox.Message): Return => {
	const result = ComboBox.update(model.timezone, message)
	const next = modifyFields(model, { timezone: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], toTimezoneMessage)
	const key = result.outMessage?.key
	return { model: key === undefined ? next : changed(next, { timezone: key }), commands }
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedUserRow: ({ row }) =>
			model.isDirty || row === null || !row.timezone || row.timezone === model.defaults.timezone
				? { model }
				: { model: formFor(model, shared, row) },
		ChangedFirstName: ({ value }) => ({ model: changed(model, { firstName: value }) }),
		ChangedLastName: ({ value }) => ({ model: changed(model, { lastName: value }) }),
		GotTimezoneMessage: ({ message: child }) => foldTimezone(model, child),
		SubmittedProfile: () =>
			model.userId === null || isSaveDisabled(model)
				? { model }
				: {
						model: modifyFields(model, { isSubmitting: () => true }),
						commands: [SaveProfile({ userId: model.userId, values: model.values })],
					},
		CompletedSaveProfile: ({ isSaved }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: isSaved
				? toast("success", "Profile updated successfully")
				: toast("error", "Failed to update profile"),
		}),
		ClickedAvatar: () => (model.isUploading ? { model } : { model, commands: [OpenFilePicker({})] }),
		CompletedOpenFilePicker: () => ({ model }),
		SelectedAvatarFiles: ({ files }) =>
			selectFile(modifyFields(model, { isDropTarget: () => false, dragDepth: () => 0 }), files),
		RejectedAvatarFile: ({ title, description }) => ({
			model,
			outMessage: toast("error", title, description),
		}),
		LoadedCropImage: ({ image }) =>
			model.crop._tag === "Loading"
				? { model: modifyFields(model, { crop: () => ({ _tag: "Ready", image }) }) }
				: { model, commands: [RevokeCropImage({ src: image.src })] },
		FailedLoadCropImage: () => closeCrop(model),
		CompletedRevokeCropImage: () => ({ model }),
		EnteredDropZone: () => ({ model: modifyFields(model, { isDropTarget: () => true }) }),
		LeftDropZone: () => ({ model: modifyFields(model, { isDropTarget: () => false }) }),
		DraggedFilesOverPage: ({ isEntering }) => ({
			model: modifyFields(model, { dragDepth: (depth) => Math.max(0, depth + (isEntering ? 1 : -1)) }),
		}),
		EndedPageDrag: () => ({
			model: modifyFields(model, { dragDepth: () => 0, isDropTarget: () => false }),
		}),
		PressedCropHandle: ({ mode, clientX, clientY }) => ({
			model: mapReadyImage(model, (image) => ({
				...image,
				drag: { mode, startX: clientX, startY: clientY, startCrop: image.crop },
			})),
		}),
		MovedCropPointer: ({ clientX, clientY }) => ({
			model: mapReadyImage(model, (image) =>
				image.drag === null ? image : { ...image, crop: dragTo(image, image.drag, clientX, clientY) },
			),
		}),
		ReleasedCropPointer: () => ({ model: mapReadyImage(model, (image) => ({ ...image, drag: null })) }),
		ClickedCancelCrop: () => closeCrop(model),
		ClickedSaveCrop: () => {
			const crop = model.crop
			return crop._tag === "Ready"
				? {
						model: modifyFields(model, {
							crop: () => ({ _tag: "Processing", image: crop.image }),
						}),
						commands: [CropAvatarImage({ src: crop.image.src, crop: crop.image.crop })],
					}
				: { model }
		},
		CompletedCropImage: ({ blob }) => {
			const crop = model.crop
			if (crop._tag !== "Processing") return { model }
			if (blob === null)
				return { model: modifyFields(model, { crop: () => ({ _tag: "Ready", image: crop.image }) }) }
			const closed = closeCrop(model)
			return {
				model: modifyFields(closed.model, { isUploading: () => true }),
				commands: [...(closed.commands ?? []), UploadAvatar({ blob })],
			}
		},
		CompletedUploadAvatar: ({ isUploaded }) => ({
			model: modifyFields(model, { isUploading: () => false }),
			outMessage: isUploaded
				? refreshUser("Profile picture updated")
				: toast("error", "Upload failed", "Failed to update profile picture. Please try again."),
		}),
		ClickedResetAvatar: () => ({
			model: modifyFields(model, { isResetting: () => true }),
			commands: [ResetAvatar({})],
		}),
		CompletedResetAvatar: ({ isReset }) => ({
			model: modifyFields(model, { isResetting: () => false }),
			outMessage: isReset
				? refreshUser("Profile picture reset to account photo")
				: toast("error", "Failed to reset profile picture"),
		}),
		GotCropModalMessage: ({ message: child }) => foldCropModal(model, child),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
