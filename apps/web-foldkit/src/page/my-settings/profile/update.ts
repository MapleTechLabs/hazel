import { Array, Option, Schema } from "effect"
import { Update } from "foldkit"
import { anyInvalid, NotValidated, validate } from "foldkit/fieldValidation"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast, errorToastOf, successToast } from "../../../data/actions"
import * as Interaction from "../../../ui/aria/interaction"
import * as ComboBox from "../../../ui/combo-box"
import * as Modal from "../../../ui/modal"
import * as TimezoneSelect from "../../../ui/timezone-select"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { UploadProblem, uploadProblemMessage, validateUploadFile } from "../../settings/upload"
import * as DropZone from "../../shared/drop-zone"
import { type UpdateUserFailure, type UserRow, updateUserFailureCopy } from "../user"
import {
	CropAvatarImage,
	LoadCropImage,
	OpenFilePicker,
	ReadProfileBrowserTimezone,
	ResetAvatar,
	RevokeCropImage,
	SaveProfile,
	UploadAvatar,
} from "./command"
import { type CropImage, dragTo } from "./crop"
import { firstNameRules, isDirty, lastNameRules, valuesOf } from "./form"
import { Message, type UploadAvatarFailure } from "./message"
import { AvatarAction, CropState, type FormValues, type Model, Save } from "./model"

type Return = PageReturn<Model, Message>
type Step = Update.Step<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)
export const toTimezoneMessage = (message: ComboBox.Message) => Message.GotTimezoneMessage({ message })
export const toCropModalMessage = (message: Modal.Message) => Message.GotCropModalMessage({ message })
export const toDropZoneMessage = (message: DropZone.Message) => Message.GotDropZoneMessage({ message })

/** The avatar changed: `refreshCurrentUser()` re-reads `user.me`, then the success toast. */
const refreshUser = (title: string) =>
	PageOutMessage.RequestedCurrentUserRefresh({ toast: successToast(title) })

/** `title`, with the reason's description (never server text). */
const updateUserToast = (title: string, reason: UpdateUserFailure) =>
	errorToast(title, failureMessage(reason, updateUserFailureCopy).description ?? null)

const isUploadProblem = Schema.is(UploadProblem)

const uploadAvatarToast = (reason: UploadAvatarFailure) =>
	isUploadProblem(reason)
		? errorToastOf(uploadProblemMessage("avatar", reason))
		: updateUserToast("Upload failed", reason)

/** `<form key={user?.id}>`: a new user starts a fresh form from their values. */
const formFor = (model: Model, shared: Shared, row: UserRow | null): Model => {
	const user = shared.currentUser
	const defaults: FormValues = {
		firstName: user?.firstName || "",
		lastName: user?.lastName || "",
		timezone: row?.timezone || model.browserTimezone,
	}
	return modifyFields(model, {
		userId: () => user?.id ?? null,
		defaults: () => defaults,
		firstName: () => NotValidated({ value: defaults.firstName }),
		lastName: () => NotValidated({ value: defaults.lastName }),
		selectedTimezone: () => defaults.timezone,
		timezone: () =>
			TimezoneSelect.init({ id: "profile-timezone", value: defaults.timezone ?? undefined }),
	})
}

const cropSrc = (crop: CropState) =>
	crop._tag === "Ready" || crop._tag === "Processing" ? crop.image.src : null

/** Closes the crop modal and releases the image (`handleCropModalOpenChange(false)`). */
const closeCrop: Step = (model) => {
	const src = cropSrc(model.crop)
	return {
		model: modifyFields(model, {
			crop: () => CropState.Idle(),
			cropModal: (modal) => modifyFields(modal, { isOpen: () => false }),
		}),
		commands: src === null ? [] : [RevokeCropImage({ src })],
	}
}

/** Applies `f` to the crop image while it is ready for editing. */
const mapReadyImage = (model: Model, f: (image: CropImage) => CropImage): Model => {
	const crop = model.crop
	return crop._tag === "Ready"
		? modifyFields(model, { crop: () => CropState.Ready({ image: f(crop.image) }) })
		: model
}

export const init = (_route: unknown, shared: Shared): Return => ({
	commands: [ReadProfileBrowserTimezone()],
	model: formFor(
		{
			userId: null,
			defaults: { firstName: "", lastName: "", timezone: null },
			firstName: NotValidated({ value: "" }),
			lastName: NotValidated({ value: "" }),
			selectedTimezone: null,
			browserTimezone: null,
			save: Save.Idle(),
			timezone: TimezoneSelect.init({ id: "profile-timezone" }),
			avatarAction: AvatarAction.Idle(),
			dropZone: DropZone.init(),
			crop: CropState.Idle(),
			cropLoadId: 0,
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
			const problem = validateUploadFile("avatar", file)
			if (problem !== null)
				return {
					model,
					outMessage: PageOutMessage.RequestedToast({
						toast: errorToastOf(uploadProblemMessage("avatar", problem)),
					}),
				}
			const loadId = model.cropLoadId + 1
			return {
				model: modifyFields(model, {
					crop: () => CropState.Loading({ loadId }),
					cropLoadId: () => loadId,
					cropModal: (modal) => modifyFields(modal, { isOpen: () => true }),
				}),
				commands: [LoadCropImage({ file, loadId })],
			}
		},
	})

const foldCropModal = Update.foldChild({
	update: Modal.update,
	read: (model: Model) => Option.some(model.cropModal),
	write: (model: Model, cropModal: Modal.Model): Model =>
		modifyFields(model, { cropModal: () => cropModal }),
	toParentMessage: toCropModalMessage,
	// Closing the dialog from inside (Escape, the backdrop, its buttons) also releases the image.
	foldOutMessage: Modal.OutMessage.match<Step>({
		Opened: () => (model) => ({ model }),
		Closed: () => closeCrop,
	}),
})

const foldTimezone = Update.foldChild({
	update: TimezoneSelect.update,
	read: (model: Model) => Option.some(model.timezone),
	write: (model: Model, timezone: ComboBox.Model): Model =>
		modifyFields(model, { timezone: () => timezone }),
	toParentMessage: toTimezoneMessage,
	foldOutMessage: (outMessage) => (model: Model) => ({
		model: modifyFields(model, { selectedTimezone: () => outMessage.key }),
	}),
})

const foldDropZone = Update.foldChild({
	update: DropZone.update,
	read: (model: Model) => Option.some(model.dropZone),
	write: (model: Model, dropZone: DropZone.Model): Model =>
		modifyFields(model, { dropZone: () => dropZone }),
	toParentMessage: toDropZoneMessage,
})

/** Validates every field (the submit shows each error, touched or not); saves a valid, changed form. */
const submit = (model: Model): Return => {
	const validated = modifyFields(model, {
		firstName: (field) => validate(firstNameRules)(field.value),
		lastName: (field) => validate(lastNameRules)(field.value),
	})
	if (
		model.userId === null ||
		model.save._tag === "Saving" ||
		!isDirty(model) ||
		anyInvalid([validated.firstName, validated.lastName])
	)
		return { model: validated }
	return {
		model: modifyFields(validated, { save: () => Save.Saving() }),
		commands: [SaveProfile({ userId: model.userId, values: valuesOf(model) })],
	}
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedUserRow: ({ row }) =>
			isDirty(model) || row === null || !row.timezone || row.timezone === model.defaults.timezone
				? { model }
				: { model: formFor(model, shared, row) },
		DetectedBrowserTimezone: ({ browserTimezone }) => {
			const next = modifyFields(model, { browserTimezone: () => browserTimezone })
			// Only an untouched form without a stored timezone falls back to the browser's.
			return isDirty(model) || model.defaults.timezone !== null
				? { model: next }
				: { model: formFor(next, shared, null) }
		},
		ChangedFirstName: ({ value }) => ({
			model: modifyFields(model, { firstName: () => validate(firstNameRules)(value) }),
		}),
		ChangedLastName: ({ value }) => ({
			model: modifyFields(model, { lastName: () => validate(lastNameRules)(value) }),
		}),
		GotTimezoneMessage: ({ message: child }) => foldTimezone(model, child),
		SubmittedProfile: () => submit(model),
		SucceededSaveProfile: ({ values }) => ({
			model: modifyFields(model, { save: () => Save.Idle(), defaults: () => values }),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast("Profile updated successfully"),
			}),
		}),
		FailedSaveProfile: ({ reason }) => ({
			model: modifyFields(model, { save: () => Save.Idle() }),
			outMessage: PageOutMessage.RequestedToast({
				toast: updateUserToast("Failed to update profile", reason),
			}),
		}),
		ClickedAvatar: () =>
			model.avatarAction._tag === "Uploading" ? { model } : { model, commands: [OpenFilePicker()] },
		CompletedOpenFilePicker: () => ({ model }),
		SelectedAvatarFiles: ({ files }) =>
			selectFile(modifyFields(model, { dropZone: () => DropZone.reset() }), files),
		LoadedCropImage: ({ loadId, image }) =>
			model.crop._tag === "Loading" && model.crop.loadId === loadId
				? { model: modifyFields(model, { crop: () => CropState.Ready({ image }) }) }
				: { model, commands: [RevokeCropImage({ src: image.src })] },
		FailedLoadCropImage: ({ loadId }) =>
			model.crop._tag === "Loading" && model.crop.loadId === loadId
				? Update.withOutMessage(
						closeCrop(model),
						PageOutMessage.RequestedToast({
							toast: errorToast("Could not open the image", "Please choose another image."),
						}),
					)
				: { model },
		CompletedRevokeCropImage: () => ({ model }),
		GotDropZoneMessage: ({ message: child }) => foldDropZone(model, child),
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
		// A removal in flight finishes first: one avatar write at a time.
		ClickedSaveCrop: () => {
			const crop = model.crop
			return crop._tag === "Ready" && model.avatarAction._tag === "Idle"
				? {
						model: modifyFields(model, {
							crop: () => CropState.Processing({ image: crop.image }),
						}),
						commands: [CropAvatarImage({ src: crop.image.src, crop: crop.image.crop })],
					}
				: { model }
		},
		SucceededCropImage: ({ blob }) => {
			const userId = model.userId
			if (model.crop._tag !== "Processing") return { model }
			if (userId === null) return closeCrop(model)
			return Update.combine(model, [
				closeCrop,
				(closed: Model) => ({
					model: modifyFields(closed, { avatarAction: () => AvatarAction.Uploading() }),
					commands: [UploadAvatar({ userId, blob })],
				}),
			])
		},
		FailedCropImage: () => {
			const crop = model.crop
			return crop._tag === "Processing"
				? {
						model: modifyFields(model, { crop: () => CropState.Ready({ image: crop.image }) }),
						outMessage: PageOutMessage.RequestedToast({
							toast: errorToast("Could not crop the image", "Please try again."),
						}),
					}
				: { model }
		},
		SucceededUploadAvatar: () => ({
			model: modifyFields(model, { avatarAction: () => AvatarAction.Idle() }),
			outMessage: refreshUser("Profile picture updated"),
		}),
		FailedUploadAvatar: ({ reason }) => ({
			model: modifyFields(model, { avatarAction: () => AvatarAction.Idle() }),
			outMessage: PageOutMessage.RequestedToast({ toast: uploadAvatarToast(reason) }),
		}),
		ClickedResetAvatar: () =>
			model.avatarAction._tag !== "Idle" || model.userId === null
				? { model }
				: {
						model: modifyFields(model, { avatarAction: () => AvatarAction.Resetting() }),
						commands: [ResetAvatar({ userId: model.userId })],
					},
		SucceededResetAvatar: () => ({
			model: modifyFields(model, { avatarAction: () => AvatarAction.Idle() }),
			outMessage: refreshUser("Profile picture removed"),
		}),
		FailedResetAvatar: ({ reason }) => ({
			model: modifyFields(model, { avatarAction: () => AvatarAction.Idle() }),
			outMessage: PageOutMessage.RequestedToast({
				toast: updateUserToast("Failed to remove profile picture", reason),
			}),
		}),
		GotCropModalMessage: ({ message: child }) => foldCropModal(model, child),
		GotInteractionMessage: ({ message: child }) => interaction.fold(model, child),
	})
