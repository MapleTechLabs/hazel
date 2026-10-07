import { CustomEmojiDeletedExistsError } from "@hazel/domain/rpc"
import { CustomEmojiId, OrganizationId, UserId } from "@hazel/schema"
import { Array, Cause, Effect, Option, Schema } from "effect"
import { Command } from "foldkit"
import * as Dom from "foldkit/dom"
import { File } from "foldkit/file"
import { modifyFields } from "foldkit/struct"
import { createCustomEmojiAction, deleteCustomEmojiAction, restoreCustomEmojiAction } from "~/db/actions"
import type { ToastRequest } from "../../../overlay/toasts"
import * as Modal from "../../../ui/modal"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { errorToast, runAtomFn, successToast } from "../../../data/actions"
import { ALLOWED_EMOJI_TYPES, MAX_EMOJI_SIZE, publicUrlOf, uploadFile } from "../upload"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

export const EMOJI_NAME_ID = "custom-emoji-name"

const NAME_PATTERN = /^[a-z0-9_-]+$/

export const generateEmojiName = (filename: string): string =>
	filename
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 64)

export const validateEmojiName = (name: string): string | null => {
	if (!name) return "Name is required"
	if (name.length > 64) return "Name must be 64 characters or less"
	if (!NAME_PATTERN.test(name)) return "Only lowercase letters, numbers, hyphens, and underscores"
	return null
}

// COMMAND

const OpenPicker = Command.define("OpenEmojiPicker", {
	args: { inputId: Schema.String },
	messages: [Message.CompletedOpenPicker],
	execute: ({ inputId }) =>
		Dom.clickElement(`#${inputId}`).pipe(Effect.ignore, Effect.as(Message.CompletedOpenPicker())),
})

const CreatePreview = Command.define("CreateEmojiPreview", {
	args: { file: File },
	messages: [Message.CreatedPreview],
	execute: ({ file }) =>
		Effect.sync(() => Message.CreatedPreview({ file, previewUrl: URL.createObjectURL(file) })),
})

const FocusName = Command.define("FocusEmojiName", {
	args: {},
	messages: [Message.CompletedFocusName],
	execute: () =>
		Dom.focus(`#${EMOJI_NAME_ID}-input`).pipe(Effect.ignore, Effect.as(Message.CompletedFocusName())),
})

const RevokePreview = Command.define("RevokeEmojiPreview", {
	args: { previewUrl: Schema.String },
	messages: [Message.CompletedRevokePreview],
	execute: ({ previewUrl }) =>
		Effect.sync(() => {
			URL.revokeObjectURL(previewUrl)
			return Message.CompletedRevokePreview()
		}),
})

const deletedExistsErrorOf = (cause: Cause.Cause<unknown>) =>
	Array.findFirst(
		cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error),
		(error): error is CustomEmojiDeletedExistsError => error instanceof CustomEmojiDeletedExistsError,
	)

const SaveEmoji = Command.define("SaveCustomEmoji", {
	args: { organizationId: OrganizationId, name: Schema.String, file: File, createdBy: UserId },
	messages: [Message.SucceededCreateEmoji, Message.FoundDeletedEmoji, Message.FailedCreateEmoji],
	execute: ({ organizationId, name, file, createdBy }) =>
		Effect.gen(function* () {
			const key = yield* uploadFile({ type: "custom-emoji", organizationId }, file)
			const imageUrl = publicUrlOf(key)
			if (imageUrl === null) {
				return Message.FailedCreateEmoji({
					toast: errorToast("Configuration error", "Image upload is not configured. Please contact support."),
				})
			}
			const exit = yield* Effect.exit(
				runAtomFn(createCustomEmojiAction, { organizationId, name, imageUrl, createdBy }),
			)
			if (exit._tag === "Success") return Message.SucceededCreateEmoji({ name })
			return Option.match(deletedExistsErrorOf(exit.cause), {
				onSome: (error) =>
					Message.FoundDeletedEmoji({
						target: {
							id: error.customEmojiId,
							name: error.name,
							imageUrl: error.imageUrl,
							newImageUrl: imageUrl,
						},
					}),
				onNone: () =>
					Message.FailedCreateEmoji({
						toast: errorToast(
							"Failed to create emoji",
							"The name may already be taken. Please try another.",
						),
					}),
			})
		}).pipe(
			Effect.catchTag("UploadFailedError", (error) =>
				Effect.succeed(Message.FailedCreateEmoji({ toast: errorToast(error.message, error.description) })),
			),
		),
})

const RestoreEmoji = Command.define("RestoreCustomEmoji", {
	args: {
		emojiId: CustomEmojiId,
		organizationId: OrganizationId,
		name: Schema.String,
		imageUrl: Schema.String,
		createdBy: UserId,
	},
	messages: [Message.SucceededRestoreEmoji, Message.FailedRestoreEmoji],
	execute: (args) =>
		runAtomFn(restoreCustomEmojiAction, args).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededRestoreEmoji({ name: args.name }),
				onFailure: () => Message.FailedRestoreEmoji(),
			}),
		),
})

export const DeleteEmoji = Command.define("DeleteCustomEmoji", {
	args: { emojiId: CustomEmojiId, name: Schema.String },
	messages: [Message.SucceededDeleteEmoji, Message.FailedDeleteEmoji],
	execute: ({ emojiId, name }) =>
		runAtomFn(deleteCustomEmojiAction, { emojiId }).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededDeleteEmoji({ name }),
				onFailure: () => Message.FailedDeleteEmoji(),
			}),
		),
})

// INIT

export const init = (): Return => ({
	model: {
		emojis: null,
		draft: null,
		isSaving: false,
		isDropTarget: false,
		deleteTarget: null,
		restoreTarget: null,
		deleteModal: Modal.init("delete-custom-emoji"),
		restoreModal: Modal.init("restore-custom-emoji"),
	},
})

// UPDATE

const toast = (model: Model, request: ToastRequest, commands: Return["commands"] = []): Return => ({
	model,
	commands,
	outMessage: PageOutMessage.RequestedToast({ toast: request }),
})

/** `handleCancel`: drop the draft and revoke its preview URL. */
const clearDraft = (model: Model): { model: Model; commands: NonNullable<Return["commands"]> } => ({
	model: modifyFields(model, { draft: () => null }),
	commands: model.draft === null ? [] : [RevokePreview({ previewUrl: model.draft.previewUrl })],
})

const closeModal = (modal: Modal.Model) => Modal.close(modal).model

const foldModal = (
	model: Model,
	key: "deleteModal" | "restoreModal",
	message: Modal.Message,
	toParent: (message: Modal.Message) => Message,
): Return => {
	const result = Modal.update(model[key], message)
	const isClosed = !result.model.isOpen
	const target = key === "deleteModal" ? "deleteTarget" : "restoreTarget"
	return {
		model: { ...model, [key]: result.model, ...(isClosed ? { [target]: null } : {}) },
		commands: Command.mapMessages(result.commands ?? [], toParent),
	}
}

const selectFile = (model: Model, file: globalThis.File): Return => {
	if (!ALLOWED_EMOJI_TYPES.includes(file.type)) {
		return toast(model, errorToast("Invalid file type", "Please select a PNG, GIF, or WebP image"))
	}
	if (file.size > MAX_EMOJI_SIZE) {
		return toast(model, errorToast("File too large", "Emoji images must be under 256KB"))
	}
	return { model, commands: [CreatePreview({ file })] }
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedEmojis: ({ emojis }) => ({ model: modifyFields(model, { emojis: () => emojis }) }),
		ClickedBrowse: ({ inputId }) => ({ model, commands: [OpenPicker({ inputId })] }),
		CompletedOpenPicker: () => ({ model }),
		SelectedFiles: ({ files }) =>
			Option.match(Array.head(files), {
				onNone: () => ({ model: modifyFields(model, { isDropTarget: () => false }) }),
				onSome: (file) => selectFile(modifyFields(model, { isDropTarget: () => false }), file),
			}),
		EnteredDropZone: () => ({ model: modifyFields(model, { isDropTarget: () => true }) }),
		LeftDropZone: () => ({ model: modifyFields(model, { isDropTarget: () => false }) }),
		CreatedPreview: ({ file, previewUrl }) => {
			const name = generateEmojiName(file.name)
			return {
				model: modifyFields(model, {
					draft: () => ({ file, previewUrl, name, nameError: name ? null : "Name is required" }),
				}),
				commands: [
					...(model.draft === null ? [] : [RevokePreview({ previewUrl: model.draft.previewUrl })]),
					FocusName({}),
				],
			}
		},
		CompletedFocusName: () => ({ model }),
		ChangedEmojiName: ({ value }) => {
			const name = value.toLowerCase()
			return {
				model: modifyFields(model, {
					draft: (draft) => (draft === null ? null : { ...draft, name, nameError: validateEmojiName(name) }),
				}),
			}
		},
		ClickedCancelUpload: () => clearDraft(model),
		CompletedRevokePreview: () => ({ model }),
		ClickedSaveEmoji: () => {
			const draft = model.draft
			if (draft === null) return { model }
			const error = validateEmojiName(draft.name)
			if (error) return { model: modifyFields(model, { draft: () => ({ ...draft, nameError: error }) }) }
			if (shared.organization === null || shared.currentUser === null || model.isSaving) return { model }
			return {
				model: modifyFields(model, { isSaving: () => true }),
				commands: [
					SaveEmoji({
						organizationId: shared.organization.id,
						name: draft.name,
						file: draft.file,
						createdBy: shared.currentUser.id,
					}),
				],
			}
		},
		SucceededCreateEmoji: ({ name }) => {
			const cleared = clearDraft(modifyFields(model, { isSaving: () => false }))
			return toast(cleared.model, successToast(`Emoji :${name}: created`), cleared.commands)
		},
		FoundDeletedEmoji: ({ target }) => ({
			model: modifyFields(model, {
				isSaving: () => false,
				restoreTarget: () => target,
				restoreModal: (modal) => Modal.open(modal).model,
			}),
		}),
		FailedCreateEmoji: ({ toast: request }) => {
			const next = modifyFields(model, { isSaving: () => false })
			return request === null ? { model: next } : toast(next, request)
		},
		ClickedConfirmRestore: () => {
			const target = model.restoreTarget
			if (target === null || shared.organization === null || shared.currentUser === null) return { model }
			return {
				model: modifyFields(model, {
					isSaving: () => true,
					restoreTarget: () => null,
					restoreModal: closeModal,
				}),
				commands: [
					RestoreEmoji({
						emojiId: target.id,
						organizationId: shared.organization.id,
						name: target.name,
						imageUrl: target.newImageUrl,
						createdBy: shared.currentUser.id,
					}),
				],
			}
		},
		SucceededRestoreEmoji: ({ name }) => {
			const cleared = clearDraft(modifyFields(model, { isSaving: () => false }))
			return toast(cleared.model, successToast(`Emoji :${name}: restored`), cleared.commands)
		},
		FailedRestoreEmoji: () =>
			toast(modifyFields(model, { isSaving: () => false }), errorToast("Failed to restore emoji")),
		ClickedDeleteEmoji: ({ id, name }) => ({
			model: modifyFields(model, {
				deleteTarget: () => ({ id, name }),
				deleteModal: (modal) => Modal.open(modal).model,
			}),
		}),
		ClickedConfirmDelete: () => {
			const target = model.deleteTarget
			if (target === null) return { model }
			return {
				model: modifyFields(model, { deleteTarget: () => null, deleteModal: closeModal }),
				commands: [DeleteEmoji({ emojiId: target.id, name: target.name })],
			}
		},
		SucceededDeleteEmoji: ({ name }) => toast(model, successToast(`Emoji :${name}: deleted`)),
		FailedDeleteEmoji: () => toast(model, errorToast("Failed to delete emoji")),
		GotDeleteModalMessage: ({ message: child }) =>
			foldModal(model, "deleteModal", child, (next) => Message.GotDeleteModalMessage({ message: next })),
		GotRestoreModalMessage: ({ message: child }) =>
			foldModal(model, "restoreModal", child, (next) => Message.GotRestoreModalMessage({ message: next })),
	})
