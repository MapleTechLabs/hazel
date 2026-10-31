import { ApiScope } from "@hazel/domain/scopes"
import { BotId } from "@hazel/schema"
import { Array, Effect, Option, Schema } from "effect"
import { Command, Submodel, Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { File } from "foldkit/file"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { BOT_SCOPES } from "~/lib/bot-scopes"
import { HazelRpc } from "../../rpc"
import { UploadTarget, uploadFile, uploadProblemMessage } from "../../page/settings/upload"
import * as DropZone from "../../page/shared/drop-zone"
import { button } from "../../ui/button"
import { dialogBody, dialogDescription, dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed, completed, ModalOutMessage } from "../out-message"
import { ToastRequest } from "../toasts"
import { BOT_AVATAR_INPUT_ID, botAvatarUpload } from "./bot-avatar-upload"
import {
	BotFormFields,
	botFormFields,
	changedDescription,
	changedName,
	initBotForm,
	isBotSubmitDisabled,
	submittedBotForm,
	toggledPublic,
	toggledScope,
} from "./bot-form"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, Message as FrameMessage, frameView, initFrame, isCloseRequest, modalTitle } from "./frame"
import { errorToastOf, failureToast, successToast } from "../../data/actions"

/**
 * `components/modals/edit-bot-modal.tsx`. The request is the settings pages' `Bot` shape (minus
 * `installCount`). The legacy `onSuccess`/`reactivityKeys` props (refresh the apps list) are not ported:
 * the list is a live query. The avatar saves on its own, as soon as it is picked (`bot.updateAvatar`).
 */

const Model = Schema.Struct({
	frame: Frame,
	botId: BotId,
	/** The saved name and avatar, as the avatar shows them (not the edited name). */
	botName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	isUploadingAvatar: Schema.Boolean,
	dropZone: DropZone.Model,
	...BotFormFields,
})
type Model = typeof Model.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedName: { value: Schema.String },
	ChangedDescription: { value: Schema.String },
	ToggledScope: { scope: ApiScope },
	ToggledPublic: { isSelected: Schema.Boolean },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededUpdateBot: { name: Schema.String },
	FailedUpdateBot: { toast: ToastRequest },
	ClickedAvatar: {},
	CompletedOpenAvatarPicker: {},
	SelectedAvatarFiles: { files: Schema.Array(File) },
	GotDropZoneMessage: { message: DropZone.Message },
	SucceededUploadAvatar: { avatarUrl: Schema.String },
	FailedUploadAvatar: { toast: ToastRequest },
})
type Message = typeof Message.Type

const errorOverrides = {
	BotNotFoundError: {
		title: "Application not found",
		description: "This application may have been deleted.",
		isRetryable: false,
	},
	RateLimitExceededError: {
		title: "Rate limit exceeded",
		description: "Please wait before trying again.",
		isRetryable: true,
	},
}

const UpdateBot = Command.define("UpdateBot", {
	args: {
		id: BotId,
		name: Schema.String,
		description: Schema.NullOr(Schema.String),
		scopes: Schema.Array(ApiScope),
		isPublic: Schema.Boolean,
	},
	messages: [Message.SucceededUpdateBot, Message.FailedUpdateBot],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("bot.update", payload)
			return Message.SucceededUpdateBot({ name: payload.name })
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedUpdateBot({ toast: failureToast(cause, "friendly", errorOverrides) }),
				),
			),
		),
})

export const OpenAvatarPicker = Command.define("OpenAvatarPicker", {
	messages: [Message.CompletedOpenAvatarPicker],
	// The hidden input's change event reports the file (`SelectedAvatarFiles`). Best effort: a missing input opens nothing.
	execute: Dom.clickElement(`#${BOT_AVATAR_INPUT_ID}`).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedOpenAvatarPicker()),
	),
})

/** `BotAvatarUpload`'s upload: store the image, then point the bot's machine user at it. */
export const UploadBotAvatar = Command.define("UploadBotAvatar", {
	args: { botId: BotId, file: File },
	messages: [Message.SucceededUploadAvatar, Message.FailedUploadAvatar],
	execute: ({ botId, file }) =>
		Effect.sync(() => {
			// Reset the input so the same file can be picked again.
			const input = document.getElementById(BOT_AVATAR_INPUT_ID)
			if (input instanceof HTMLInputElement) input.value = ""
		}).pipe(
			Effect.andThen(uploadFile(UploadTarget.BotAvatar({ botId }), file)),
			Effect.tap((avatarUrl) =>
				Effect.gen(function* () {
					const client = yield* HazelRpc
					yield* client("bot.updateAvatar", { id: botId, avatarUrl })
				}),
			),
			Effect.map((avatarUrl) => Message.SucceededUploadAvatar({ avatarUrl })),
			Effect.catchTag("UploadFailedError", ({ problem }) =>
				Effect.succeed(
					Message.FailedUploadAvatar({
						toast: errorToastOf(uploadProblemMessage("avatar", problem)),
					}),
				),
			),
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedUploadAvatar({ toast: failureToast(cause, "friendly", errorOverrides) }),
				),
			),
		),
})

type Return = ModalReturn<Model, Message>

const foldDropZone = Update.foldChild({
	update: DropZone.update,
	read: (model: Model) => Option.some(model.dropZone),
	write: (model: Model, dropZone: DropZone.Model): Model =>
		modifyFields(model, { dropZone: () => dropZone }),
	toParentMessage: (message: DropZone.Message) => Message.GotDropZoneMessage({ message }),
})

/** One upload at a time; the first file of a pick or drop. */
const selectedAvatar = (model: Model, files: ReadonlyArray<File>): Return => {
	const next = modifyFields(model, { dropZone: () => DropZone.reset() })
	return model.isUploadingAvatar
		? { model: next }
		: Option.match(Array.head(files), {
				onNone: () => ({ model: next }),
				onSome: (file) => ({
					model: modifyFields(next, { isUploadingAvatar: () => true }),
					commands: [UploadBotAvatar({ botId: model.botId, file })],
				}),
			})
}

const submitted = (model: Model): Return => {
	const { model: next, isReady } = submittedBotForm(model)
	if (!isReady) return { model: next }
	return {
		model: modifyFields(next, { isSubmitting: () => true }),
		commands: [
			UpdateBot({
				id: next.botId,
				name: next.name,
				description: next.description || null,
				scopes: next.scopes,
				isPublic: next.isPublic,
			}),
		],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ChangedName: ({ value }) => ({ model: changedName(model, value) }),
		ChangedDescription: ({ value }) => ({ model: changedDescription(model, value) }),
		ToggledScope: ({ scope }) => ({ model: toggledScope(model, scope) }),
		ToggledPublic: ({ isSelected }) => ({ model: toggledPublic(model, isSelected) }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		SucceededUpdateBot: ({ name }) => ({
			model,
			outMessage: completed({ toast: successToast(`Application "${name}" updated successfully`) }),
		}),
		FailedUpdateBot: ({ toast }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
		ClickedAvatar: () =>
			model.isUploadingAvatar ? { model } : { model, commands: [OpenAvatarPicker()] },
		CompletedOpenAvatarPicker: () => ({ model }),
		SelectedAvatarFiles: ({ files }) => selectedAvatar(model, files),
		GotDropZoneMessage: ({ message }) => foldDropZone(model, message),
		SucceededUploadAvatar: ({ avatarUrl }) => ({
			model: modifyFields(model, { isUploadingAvatar: () => false, avatarUrl: () => avatarUrl }),
			outMessage: ModalOutMessage.RequestedToast({ toast: successToast("Avatar updated") }),
		}),
		FailedUploadAvatar: ({ toast }) => ({
			model: modifyFields(model, { isUploadingAvatar: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const ID = "edit-bot-modal"

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Edit Application"),
				dialogDescription(h, "Update your application settings and permissions"),
			]),
			h.form(
				[h.OnSubmit(Message.SubmittedForm())],
				[
					dialogBody(
						h,
						[
							h.div(
								[h.Class("flex justify-center")],
								[
									botAvatarUpload(h, {
										name: model.botName,
										avatarUrl: model.avatarUrl,
										isUploading: model.isUploadingAvatar,
										dropZone: model.dropZone,
										toDropZoneMessage: (message) =>
											Message.GotDropZoneMessage({ message }),
										onPress: Message.ClickedAvatar(),
										onFiles: (files) => Message.SelectedAvatarFiles({ files }),
									}),
								],
							),
							...botFormFields(h, {
								id: ID,
								form: model,
								onName: (value) => Message.ChangedName({ value }),
								onDescription: (value) => Message.ChangedDescription({ value }),
								onToggleScope: (scope) => Message.ToggledScope({ scope }),
								onPublic: (isSelected) => Message.ToggledPublic({ isSelected }),
							}),
						],
						"flex flex-col gap-6",
					),
					dialogFooter(h, [
						button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
						button(
							h,
							{
								intent: "primary",
								isDisabled: isBotSubmitDisabled(model),
								attributes: [h.Type("submit")],
							},
							[model.isSubmitting ? "Saving..." : "Save Changes"],
						),
					]),
				],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

/** Legacy keeps only the scopes the permissions UI knows. */
const isKnownScope = (scope: string): scope is ApiScope => BOT_SCOPES.some((known) => known.id === scope)
const knownScopes = (scopes: ReadonlyArray<string>): Array<ApiScope> => scopes.filter(isKnownScope)

export const modal = defineModal(
	"EditBot",
	{
		request: Requests.EditBot,
		Model,
		Message,
	},
	{
		init: (request) => ({
			model: {
				frame: initFrame(ID),
				botId: request.id,
				botName: request.name,
				avatarUrl: request.avatarUrl,
				isUploadingAvatar: false,
				dropZone: DropZone.init(),
				...initBotForm({
					name: request.name,
					description: request.description ?? "",
					scopes: knownScopes(request.scopes),
					isPublic: request.isPublic,
				}),
			},
		}),
		update,
		view,
	},
)
