import { ApiScope } from "@hazel/domain/scopes"
import { BotId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { BOT_SCOPES } from "~/lib/bot-scopes"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogBody, dialogDescription, dialogFooter, dialogHeader } from "../../ui/dialog"
import { toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import { botAvatarUpload } from "./bot-avatar-upload"
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
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/**
 * `components/modals/edit-bot-modal.tsx`. The request is the settings pages' `Bot` shape (minus
 * `installCount`). The legacy `onSuccess`/`reactivityKeys` props (refresh the apps list) are not ported.
 */

const Model = Schema.Struct({
	frame: Frame,
	botId: BotId,
	/** The saved name and avatar, as the avatar shows them (not the edited name). */
	botName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	...BotFormFields,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedName: { value: Schema.String },
	ChangedDescription: { value: Schema.String },
	ToggledScope: { scope: ApiScope },
	ToggledPublic: { isSelected: Schema.Boolean },
	ClickedCancel: {},
	SubmittedForm: {},
	SucceededUpdateBot: { name: Schema.String },
	FailedUpdateBot: { toast: ToastRequest },
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
				Effect.succeed(Message.FailedUpdateBot({ toast: toastForCause(cause, errorOverrides) })),
			),
		),
})

type Return = ModalReturn<Model, Message>

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

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
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
								[botAvatarUpload(h, { name: model.botName, avatarUrl: model.avatarUrl })],
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
							{ intent: "primary", isDisabled: isBotSubmitDisabled(model), attributes: [h.Type("submit")] },
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
