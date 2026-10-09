import { CustomEmojiDeletedExistsError } from "@hazel/domain/rpc"
import { CustomEmojiId, OrganizationId, UserId } from "@hazel/schema"
import { Array, Cause, Effect, Option, Schema } from "effect"
import { Command, Update } from "foldkit"
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

export const OpenEmojiPicker = Command.define("OpenEmojiPicker", {
	args: { inputId: Schema.String },
	messages: [Message.CompletedOpenPicker],
	execute: ({ inputId }) =>
		Dom.clickElement(`#${inputId}`).pipe(Effect.ignore, Effect.as(Message.CompletedOpenPicker())),
})

export const CreateEmojiPreview = Command.define("CreateEmojiPreview", {
	args: { file: File },
	messages: [Message.CreatedPreview],
	execute: ({ file }) =>
		Effect.sync(() => Message.CreatedPreview({ file, previewUrl: URL.createObjectURL(file) })),
})

export const FocusEmojiName = Command.define("FocusEmojiName", {
	messages: [Message.CompletedFocusName],
	execute: Dom.focus(`#${EMOJI_NAME_ID}-input`).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedFocusName()),
	),
})

export const RevokeEmojiPreview = Command.define("RevokeEmojiPreview", {
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

/** Uploads the draft's file and creates the emoji; `previewUrl` names the draft the result belongs to. */
export const CreateCustomEmoji = Command.define("CreateCustomEmoji", {
	args: {
		organizationId: OrganizationId,
		name: Schema.String,
		file: File,
		previewUrl: Schema.String,
		createdBy: UserId,
	},
	messages: [Message.SucceededCreateEmoji, Message.FoundDeletedEmoji, Message.FailedCreateEmoji],
	execute: ({ organizationId, name, file, previewUrl, createdBy }) =>
		Effect.gen(function* () {
			const key = yield* uploadFile({ type: "custom-emoji", organizationId }, file)
			const imageUrl = publicUrlOf(key)
			if (imageUrl === null) {
				return Message.FailedCreateEmoji({
					toast: errorToast(
						"Configuration error",
						"Image upload is not configured. Please contact support.",
					),
				})
			}
			const exit = yield* Effect.exit(
				runAtomFn(createCustomEmojiAction, { organizationId, name, imageUrl, createdBy }),
			)
			if (exit._tag === "Success") return Message.SucceededCreateEmoji({ name, previewUrl })
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
				Effect.succeed(
					Message.FailedCreateEmoji({ toast: errorToast(error.message, error.description) }),
				),
			),
		),
})

export const RestoreCustomEmoji = Command.define("RestoreCustomEmoji", {
	args: {
		emojiId: CustomEmojiId,
		organizationId: OrganizationId,
		name: Schema.String,
		imageUrl: Schema.String,
		createdBy: UserId,
		/** The draft that hit the deleted name, cleared on success unless the user picked another. */
		previewUrl: Schema.NullOr(Schema.String),
	},
	messages: [Message.SucceededRestoreEmoji, Message.FailedRestoreEmoji],
	execute: ({ previewUrl, ...args }) =>
		runAtomFn(restoreCustomEmojiAction, args).pipe(
			Effect.match({
				onSuccess: () => Message.SucceededRestoreEmoji({ name: args.name, previewUrl }),
				onFailure: () => Message.FailedRestoreEmoji(),
			}),
		),
})

export const DeleteCustomEmoji = Command.define("DeleteCustomEmoji", {
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
	commands: model.draft === null ? [] : [RevokeEmojiPreview({ previewUrl: model.draft.previewUrl })],
})

const modalFold = (
	key: "deleteModal" | "restoreModal",
	toParentMessage: (message: Modal.Message) => Message,
) => {
	const target = key === "deleteModal" ? "deleteTarget" : "restoreTarget"
	return {
		read: (model: Model) => Option.some(model[key]),
		// A closed dialog forgets its target (legacy `onOpenChange(false)`).
		write: (model: Model, modal: Modal.Model): Model => ({
			...model,
			[key]: modal,
			...(modal.isOpen ? {} : { [target]: null }),
		}),
		toParentMessage,
	}
}
const deleteModal = modalFold("deleteModal", (message) => Message.GotDeleteModalMessage({ message }))
const restoreModal = modalFold("restoreModal", (message) => Message.GotRestoreModalMessage({ message }))
const foldDeleteModal = Update.foldChild({ update: Modal.update, ...deleteModal })
const openDeleteModal = Update.foldChildStep({ update: Modal.open, ...deleteModal })
const closeDeleteModal = Update.foldChildStep({ update: Modal.close, ...deleteModal })
const foldRestoreModal = Update.foldChild({ update: Modal.update, ...restoreModal })
const openRestoreModal = Update.foldChildStep({ update: Modal.open, ...restoreModal })
const closeRestoreModal = Update.foldChildStep({ update: Modal.close, ...restoreModal })

/** Clears the draft only if it is still the one the result belongs to. */
const clearDraftOf = (model: Model, previewUrl: string | null): Return =>
	model.draft !== null && model.draft.previewUrl === previewUrl
		? clearDraft(model)
		: { model }

const withCommands = (result: Return, commands: Return["commands"]): Return => ({
	...result,
	commands: [...(result.commands ?? []), ...(commands ?? [])],
})

const selectFile = (model: Model, file: globalThis.File): Return => {
	if (!ALLOWED_EMOJI_TYPES.includes(file.type)) {
		return toast(model, errorToast("Invalid file type", "Please select a PNG, GIF, or WebP image"))
	}
	if (file.size > MAX_EMOJI_SIZE) {
		return toast(model, errorToast("File too large", "Emoji images must be under 256KB"))
	}
	return { model, commands: [CreateEmojiPreview({ file })] }
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedEmojis: ({ emojis }) => ({ model: modifyFields(model, { emojis: () => emojis }) }),
		ClickedBrowse: ({ inputId }) => ({ model, commands: [OpenEmojiPicker({ inputId })] }),
		CompletedOpenPicker: () => ({ model }),
		// A file picked while a save runs would replace the draft being saved.
		SelectedFiles: ({ files }) =>
			Option.match(model.isSaving ? Option.none() : Array.head(files), {
				onNone: () => ({ model: modifyFields(model, { isDropTarget: () => false }) }),
				onSome: (file) => selectFile(modifyFields(model, { isDropTarget: () => false }), file),
			}),
		EnteredDropZone: () => ({ model: modifyFields(model, { isDropTarget: () => true }) }),
		LeftDropZone: () => ({ model: modifyFields(model, { isDropTarget: () => false }) }),
		CreatedPreview: ({ file, previewUrl }) => {
			if (model.isSaving) return { model, commands: [RevokeEmojiPreview({ previewUrl })] }
			const name = generateEmojiName(file.name)
			return {
				model: modifyFields(model, {
					draft: () => ({ file, previewUrl, name, nameError: name ? null : "Name is required" }),
				}),
				commands: [
					...(model.draft === null
						? []
						: [RevokeEmojiPreview({ previewUrl: model.draft.previewUrl })]),
					FocusEmojiName(),
				],
			}
		},
		CompletedFocusName: () => ({ model }),
		ChangedEmojiName: ({ value }) => {
			const name = value.toLowerCase()
			return {
				model: modifyFields(model, {
					draft: (draft) =>
						draft === null ? null : { ...draft, name, nameError: validateEmojiName(name) },
				}),
			}
		},
		ClickedCancelUpload: () => clearDraft(model),
		CompletedRevokePreview: () => ({ model }),
		ClickedSaveEmoji: () => {
			const draft = model.draft
			if (draft === null) return { model }
			const error = validateEmojiName(draft.name)
			if (error)
				return { model: modifyFields(model, { draft: () => modifyFields(draft, { nameError: () => error }) }) }
			if (shared.organization === null || shared.currentUser === null || model.isSaving)
				return { model }
			return {
				model: modifyFields(model, { isSaving: () => true }),
				commands: [
					CreateCustomEmoji({
						organizationId: shared.organization.id,
						name: draft.name,
						file: draft.file,
						previewUrl: draft.previewUrl,
						createdBy: shared.currentUser.id,
					}),
				],
			}
		},
		SucceededCreateEmoji: ({ name, previewUrl }) => {
			const cleared = clearDraftOf(modifyFields(model, { isSaving: () => false }), previewUrl)
			return toast(cleared.model, successToast(`Emoji :${name}: created`), cleared.commands)
		},
		FoundDeletedEmoji: ({ target }) =>
			openRestoreModal(modifyFields(model, { isSaving: () => false, restoreTarget: () => target })),
		FailedCreateEmoji: ({ toast: request }) =>
			toast(modifyFields(model, { isSaving: () => false }), request),
		ClickedConfirmRestore: () => {
			const target = model.restoreTarget
			if (
				target === null ||
				shared.organization === null ||
				shared.currentUser === null ||
				model.isSaving
			) {
				return { model }
			}
			return withCommands(closeRestoreModal(modifyFields(model, { isSaving: () => true })), [
				RestoreCustomEmoji({
					emojiId: target.id,
					organizationId: shared.organization.id,
					name: target.name,
					imageUrl: target.newImageUrl,
					createdBy: shared.currentUser.id,
					previewUrl: model.draft?.previewUrl ?? null,
				}),
			])
		},
		SucceededRestoreEmoji: ({ name, previewUrl }) => {
			const cleared = clearDraftOf(modifyFields(model, { isSaving: () => false }), previewUrl)
			return toast(cleared.model, successToast(`Emoji :${name}: restored`), cleared.commands)
		},
		FailedRestoreEmoji: () =>
			toast(modifyFields(model, { isSaving: () => false }), errorToast("Failed to restore emoji")),
		ClickedDeleteEmoji: ({ id, name }) =>
			openDeleteModal(modifyFields(model, { deleteTarget: () => ({ id, name }) })),
		ClickedConfirmDelete: () => {
			const target = model.deleteTarget
			if (target === null) return { model }
			return withCommands(closeDeleteModal(model), [
				DeleteCustomEmoji({ emojiId: target.id, name: target.name }),
			])
		},
		SucceededDeleteEmoji: ({ name }) => toast(model, successToast(`Emoji :${name}: deleted`)),
		FailedDeleteEmoji: () => toast(model, errorToast("Failed to delete emoji")),
		GotDeleteModalMessage: ({ message: child }) => foldDeleteModal(model, child),
		GotRestoreModalMessage: ({ message: child }) => foldRestoreModal(model, child),
	})
