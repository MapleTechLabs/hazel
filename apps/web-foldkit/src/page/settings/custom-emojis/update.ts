import { CustomEmojiId, OrganizationId, UserId } from "@hazel/schema"
import { Array, Effect, Option, Schema } from "effect"
import { Command, Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { makeRules, Rule, validate } from "foldkit/fieldValidation"
import { File } from "foldkit/file"
import { modifyFields } from "foldkit/struct"
import { createCustomEmojiAction, deleteCustomEmojiAction, restoreCustomEmojiAction } from "~/db/actions"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf, successToast } from "../../../data/actions"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import * as DropZone from "../../shared/drop-zone"
import { UploadProblem, UploadTarget, uploadFile, uploadProblemMessage, validateUploadFile } from "../upload"
import { Message } from "./message"
import type {
	CreateFailure,
	DeleteFailure,
	DeleteTarget,
	Model,
	RestoreFailure,
	RestoreTarget,
} from "./model"

type Return = PageReturn<Model, Message>

export const EMOJI_NAME_ID = "custom-emoji-name"

export const generateEmojiName = (filename: string): string =>
	filename
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 64)

/** The legacy shortcode rules and copy. */
export const emojiNameRules = makeRules({
	required: "Name is required",
	rules: [
		Rule.maxLength(64, "Name must be 64 characters or less"),
		Rule.pattern(/^[a-z0-9_-]+$/, "Only lowercase letters, numbers, hyphens, and underscores"),
	],
})

export const validateEmojiName = validate(emojiNameRules)

// COMMAND

export const OpenEmojiPicker = Command.define("OpenEmojiPicker", {
	args: { inputId: Schema.String },
	messages: [Message.CompletedOpenPicker],
	execute: ({ inputId }) =>
		// Best effort: a missing input just means nothing opens.
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
	// Best effort: focus is a convenience.
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
	execute: ({ organizationId, name, file, previewUrl, createdBy }) => {
		const failed = (reason: CreateFailure) => Effect.succeed(Message.FailedCreateEmoji({ reason }))
		return uploadFile(UploadTarget.CustomEmoji({ organizationId }), file).pipe(
			Effect.flatMap((imageUrl) =>
				createCustomEmojiAction({ organizationId, name, imageUrl, createdBy }).pipe(
					Effect.as(Message.SucceededCreateEmoji({ name, previewUrl })),
					Effect.catchTags({
						// A deleted emoji holds the name: offer to restore it with the new image.
						CustomEmojiDeletedExistsError: (error) =>
							Effect.succeed(
								Message.FoundDeletedEmoji({
									target: {
										id: error.customEmojiId,
										name: error.name,
										imageUrl: error.imageUrl,
										newImageUrl: imageUrl,
									},
								}),
							),
						CustomEmojiNameConflictError: () => failed("NameTaken"),
					}),
				),
			),
			Effect.catchTags({ UploadFailedError: (error) => failed(error.problem) }),
			catchCommon((reason) => Message.FailedCreateEmoji({ reason })),
		)
	},
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
	execute: ({ previewUrl, ...args }) => {
		const failed = (reason: RestoreFailure) => Effect.succeed(Message.FailedRestoreEmoji({ reason }))
		return restoreCustomEmojiAction(args).pipe(
			Effect.as(Message.SucceededRestoreEmoji({ name: args.name, previewUrl })),
			Effect.catchTags({
				CustomEmojiNotFoundError: () => failed("NotFound"),
				CustomEmojiNameConflictError: () => failed("NameTaken"),
			}),
			catchCommon((reason) => Message.FailedRestoreEmoji({ reason })),
		)
	},
})

export const DeleteCustomEmoji = Command.define("DeleteCustomEmoji", {
	args: { emojiId: CustomEmojiId, name: Schema.String },
	messages: [Message.SucceededDeleteEmoji, Message.FailedDeleteEmoji],
	execute: ({ emojiId, name }) =>
		deleteCustomEmojiAction({ emojiId }).pipe(
			Effect.as(Message.SucceededDeleteEmoji({ name })),
			Effect.catchTags({
				CustomEmojiNotFoundError: () =>
					Effect.succeed(Message.FailedDeleteEmoji({ reason: "NotFound" satisfies DeleteFailure })),
			}),
			catchCommon((reason) => Message.FailedDeleteEmoji({ reason })),
		),
})

// INIT

export const init = (): Return => ({
	model: {
		emojis: null,
		draft: null,
		isCreating: false,
		dropZone: DropZone.init(),
		deleteConfirm: ConfirmAction.init<DeleteTarget>("delete-custom-emoji"),
		restoreConfirm: ConfirmAction.init<RestoreTarget>("restore-custom-emoji"),
	},
})

// COPY

const isUploadProblem = Schema.is(UploadProblem)

const createFailureMessage = (reason: CreateFailure): UserErrorMessage =>
	isUploadProblem(reason)
		? uploadProblemMessage("emoji", reason)
		: failureMessage(reason, {
				NameTaken: {
					title: "Failed to create emoji",
					description: "The name is already taken. Please try another.",
				},
			})

const restoreFailureMessage = (reason: RestoreFailure): UserErrorMessage =>
	failureMessage(reason, {
		NotFound: { title: "Failed to restore emoji", description: "The deleted emoji no longer exists." },
		NameTaken: {
			title: "Failed to restore emoji",
			description: "Another emoji already uses this name. Please try another.",
		},
	})

const deleteFailureMessage = (reason: DeleteFailure): UserErrorMessage =>
	failureMessage(reason, {
		NotFound: { title: "Failed to delete emoji", description: "It may have already been deleted." },
	})

// UPDATE

/** A create or a confirmed restore is running; the draft is locked meanwhile. */
export const isBusy = (model: Model) => model.isCreating || ConfirmAction.isRunning(model.restoreConfirm)

/** `handleCancel`: drop the draft and revoke its preview URL. */
type Cleared = { readonly model: Model; readonly commands?: Return["commands"] }

const clearDraft = (model: Model): Cleared => ({
	model: modifyFields(model, { draft: () => null }),
	commands: model.draft === null ? [] : [RevokeEmojiPreview({ previewUrl: model.draft.previewUrl })],
})

/** Clears the draft only if it is still the one the result belongs to. */
const clearDraftOf = (model: Model, previewUrl: string | null): Cleared =>
	model.draft !== null && model.draft.previewUrl === previewUrl ? clearDraft(model) : { model }

const foldDeleteConfirm = Update.foldChild({
	update: (child: ConfirmAction.Model<DeleteTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(child, message),
	read: (model: Model) => Option.some(model.deleteConfirm),
	write: (model: Model, deleteConfirm: ConfirmAction.Model<DeleteTarget>): Model => ({
		...model,
		deleteConfirm,
	}),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotDeleteConfirmMessage({ message }),
})

const foldRestoreConfirm = Update.foldChild({
	update: (child: ConfirmAction.Model<RestoreTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(child, message),
	read: (model: Model) => Option.some(model.restoreConfirm),
	write: (model: Model, restoreConfirm: ConfirmAction.Model<RestoreTarget>): Model => ({
		...model,
		restoreConfirm,
	}),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotRestoreConfirmMessage({ message }),
})

const foldDropZone = Update.foldChild({
	update: DropZone.update,
	read: (model: Model) => Option.some(model.dropZone),
	write: (model: Model, dropZone: DropZone.Model): Model => ({ ...model, dropZone }),
	toParentMessage: (message: DropZone.Message) => Message.GotDropZoneMessage({ message }),
})

/** The file checks `uploadFile` runs, up front so a bad file never becomes a draft. */
const selectFile = (model: Model, file: globalThis.File): Return => {
	const problem = validateUploadFile("emoji", file)
	return problem === null
		? { model, commands: [CreateEmojiPreview({ file })] }
		: {
				model,
				outMessage: PageOutMessage.RequestedToast({
					toast: errorToastOf(uploadProblemMessage("emoji", problem)),
				}),
			}
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedEmojis: ({ emojis }) => ({ model: modifyFields(model, { emojis: () => emojis }) }),
		ClickedBrowse: ({ inputId }) => ({ model, commands: [OpenEmojiPicker({ inputId })] }),
		CompletedOpenPicker: () => ({ model }),
		// A file picked while a save runs would replace the draft being saved.
		SelectedFiles: ({ files }) => {
			const dropped = modifyFields(model, { dropZone: () => DropZone.reset() })
			return Option.match(isBusy(model) ? Option.none() : Array.head(files), {
				onNone: () => ({ model: dropped }),
				onSome: (file) => selectFile(dropped, file),
			})
		},
		GotDropZoneMessage: ({ message: child }) => foldDropZone(model, child),
		CreatedPreview: ({ file, previewUrl }) => {
			if (isBusy(model)) return { model, commands: [RevokeEmojiPreview({ previewUrl })] }
			return {
				model: modifyFields(model, {
					draft: () => ({
						file,
						previewUrl,
						name: validateEmojiName(generateEmojiName(file.name)),
					}),
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
		ChangedEmojiName: ({ value }) => ({
			model: modifyFields(model, {
				draft: (draft) =>
					draft === null
						? null
						: modifyFields(draft, { name: () => validateEmojiName(value.toLowerCase()) }),
			}),
		}),
		ClickedCancelUpload: () => clearDraft(model),
		CompletedRevokePreview: () => ({ model }),
		ClickedSaveEmoji: () => {
			const draft = model.draft
			if (draft === null) return { model }
			const name = validateEmojiName(draft.name.value)
			if (name._tag !== "Valid")
				return {
					model: modifyFields(model, { draft: () => modifyFields(draft, { name: () => name }) }),
				}
			if (shared.organization === null || shared.currentUser === null || isBusy(model)) return { model }
			return {
				model: modifyFields(model, { isCreating: () => true }),
				commands: [
					CreateCustomEmoji({
						organizationId: shared.organization.id,
						name: name.value,
						file: draft.file,
						previewUrl: draft.previewUrl,
						createdBy: shared.currentUser.id,
					}),
				],
			}
		},
		SucceededCreateEmoji: ({ name, previewUrl }) =>
			Update.withOutMessage(
				clearDraftOf(modifyFields(model, { isCreating: () => false }), previewUrl),
				PageOutMessage.RequestedToast({ toast: successToast(`Emoji :${name}: created`) }),
			),
		FoundDeletedEmoji: ({ target }) => ({
			model: modifyFields(model, {
				isCreating: () => false,
				restoreConfirm: (confirm) => ConfirmAction.ask(confirm, target),
			}),
		}),
		FailedCreateEmoji: ({ reason }) =>
			Update.withOutMessage(
				{ model: modifyFields(model, { isCreating: () => false }) },
				PageOutMessage.RequestedToast({ toast: errorToastOf(createFailureMessage(reason)) }),
			),
		ClickedConfirmRestore: () => {
			const organization = shared.organization
			const user = shared.currentUser
			if (organization === null || user === null || model.isCreating) return { model }
			return Option.match(ConfirmAction.confirm(model.restoreConfirm), {
				onNone: () => ({ model }),
				onSome: ([restoreConfirm, target]) => ({
					model: modifyFields(model, { restoreConfirm: () => restoreConfirm }),
					commands: [
						RestoreCustomEmoji({
							emojiId: target.id,
							organizationId: organization.id,
							name: target.name,
							imageUrl: target.newImageUrl,
							createdBy: user.id,
							previewUrl: model.draft?.previewUrl ?? null,
						}),
					],
				}),
			})
		},
		SucceededRestoreEmoji: ({ name, previewUrl }) =>
			Update.withOutMessage(
				clearDraftOf(modifyFields(model, { restoreConfirm: ConfirmAction.close }), previewUrl),
				PageOutMessage.RequestedToast({ toast: successToast(`Emoji :${name}: restored`) }),
			),
		FailedRestoreEmoji: ({ reason }) =>
			Update.withOutMessage(
				{ model: modifyFields(model, { restoreConfirm: ConfirmAction.failed }) },
				PageOutMessage.RequestedToast({ toast: errorToastOf(restoreFailureMessage(reason)) }),
			),
		ClickedDeleteEmoji: ({ id, name }) => ({
			model: modifyFields(model, {
				deleteConfirm: (confirm) => ConfirmAction.ask(confirm, { id, name }),
			}),
		}),
		ClickedConfirmDelete: () =>
			Option.match(ConfirmAction.confirm(model.deleteConfirm), {
				onNone: () => ({ model }),
				onSome: ([deleteConfirm, target]) => ({
					model: modifyFields(model, { deleteConfirm: () => deleteConfirm }),
					commands: [DeleteCustomEmoji({ emojiId: target.id, name: target.name })],
				}),
			}),
		SucceededDeleteEmoji: ({ name }) =>
			Update.withOutMessage(
				{ model: modifyFields(model, { deleteConfirm: ConfirmAction.close }) },
				PageOutMessage.RequestedToast({ toast: successToast(`Emoji :${name}: deleted`) }),
			),
		FailedDeleteEmoji: ({ reason }) =>
			Update.withOutMessage(
				{ model: modifyFields(model, { deleteConfirm: ConfirmAction.failed }) },
				PageOutMessage.RequestedToast({ toast: errorToastOf(deleteFailureMessage(reason)) }),
			),
		GotDeleteConfirmMessage: ({ message: child }) => foldDeleteConfirm(model, child),
		GotRestoreConfirmMessage: ({ message: child }) => foldRestoreConfirm(model, child),
	})
