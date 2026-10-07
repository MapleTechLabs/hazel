import { ApiScope } from "@hazel/domain/scopes"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogBody, dialogDescription, dialogFooter, dialogHeader } from "../../ui/dialog"
import { toastForCause } from "../action"
import { closed, errorToast, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
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
import { botTokenDisplay } from "./bot-token-display"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/**
 * `components/modals/create-bot-modal.tsx`. After creation it shows the token in place. The legacy
 * `onSuccess`/`reactivityKeys` props (refresh the your-apps list) are not ported.
 */

const Model = Schema.Struct({
	frame: Frame,
	...BotFormFields,
	createdBotToken: Schema.NullOr(Schema.String),
	createdBotName: Schema.String,
	isTokenVisible: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedName: { value: Schema.String },
	ChangedDescription: { value: Schema.String },
	ToggledScope: { scope: ApiScope },
	ToggledPublic: { isSelected: Schema.Boolean },
	ClickedCancel: {},
	ClickedDone: {},
	SubmittedForm: {},
	SucceededCreateBot: { token: Schema.String, name: Schema.String },
	FailedCreateBot: { toast: ToastRequest },
	ClickedToggleTokenVisible: {},
	ClickedCopyToken: {},
	SucceededCopyToken: {},
	FailedCopyToken: {},
})
type Message = typeof Message.Type

const rateLimitToast = {
	RateLimitExceededError: {
		title: "Rate limit exceeded",
		description: "Please wait before trying again.",
		isRetryable: true,
	},
}

const CreateBot = Command.define("CreateBot", {
	args: {
		name: Schema.String,
		description: Schema.optional(Schema.String),
		scopes: Schema.Array(ApiScope),
		isPublic: Schema.Boolean,
	},
	messages: [Message.SucceededCreateBot, Message.FailedCreateBot],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("bot.create", payload)
			return Message.SucceededCreateBot({ token: result.token, name: payload.name })
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(Message.FailedCreateBot({ toast: toastForCause(cause, rateLimitToast) })),
			),
		),
})

const CopyToken = Command.define("CopyToken", {
	args: { token: Schema.String },
	messages: [Message.SucceededCopyToken, Message.FailedCopyToken],
	execute: ({ token }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(token)).pipe(
			Effect.as(Message.SucceededCopyToken()),
			Effect.catchCause(() => Effect.succeed(Message.FailedCopyToken())),
		),
})

type Return = ModalReturn<Model, Message>

const submitted = (model: Model): Return => {
	const { model: next, isReady } = submittedBotForm(model)
	if (!isReady) return { model: next }
	return {
		model: modifyFields(next, { isSubmitting: () => true }),
		commands: [
			CreateBot({
				name: next.name,
				description: next.description || undefined,
				scopes: next.scopes,
				isPublic: next.isPublic,
			}),
		],
	}
}

const toast = (request: ToastRequest) => ModalOutMessage.RequestedToast({ toast: request })

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		ChangedName: ({ value }) => ({ model: changedName(model, value) }),
		ChangedDescription: ({ value }) => ({ model: changedDescription(model, value) }),
		ToggledScope: ({ scope }) => ({ model: toggledScope(model, scope) }),
		ToggledPublic: ({ isSelected }) => ({ model: toggledPublic(model, isSelected) }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedDone: () => ({ model, outMessage: closed }),
		SubmittedForm: () => submitted(model),
		SucceededCreateBot: ({ token, name }) => ({
			model: modifyFields(model, {
				isSubmitting: () => false,
				createdBotToken: () => token,
				createdBotName: () => name,
			}),
			outMessage: toast(successToast(`Application "${name}" created successfully`)),
		}),
		FailedCreateBot: ({ toast: request }) => ({
			model: modifyFields(model, { isSubmitting: () => false }),
			outMessage: toast(request),
		}),
		ClickedToggleTokenVisible: () => ({ model: modifyFields(model, { isTokenVisible: (value) => !value }) }),
		ClickedCopyToken: () =>
			model.createdBotToken === null ? { model } : { model, commands: [CopyToken({ token: model.createdBotToken })] },
		SucceededCopyToken: () => ({ model, outMessage: toast(successToast("Token copied to clipboard")) }),
		FailedCopyToken: () => ({ model, outMessage: toast(errorToast("Failed to copy token")) }),
	})

const ID = "create-bot-modal"

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() =>
			model.createdBotToken !== null
				? [
						dialogHeader(h, {}, [
							modalTitle(h, model.frame, "Application Created Successfully"),
							dialogDescription(
								h,
								`Your application "${model.createdBotName}" has been created. Save the token below - you won't be able to see it again.`,
							),
						]),
						dialogBody(h, [
							botTokenDisplay(h, {
								token: model.createdBotToken,
								isVisible: model.isTokenVisible,
								onToggleVisible: Message.ClickedToggleTokenVisible(),
								onCopy: Message.ClickedCopyToken(),
							}),
						]),
						dialogFooter(h, [button(h, { intent: "primary", onPress: Message.ClickedDone() }, ["Done"])]),
					]
				: [
						dialogHeader(h, {}, [
							modalTitle(h, model.frame, "Create Application"),
							dialogDescription(
								h,
								"Create an application to interact with your workspace programmatically using the SDK",
							),
						]),
						h.form(
							[h.OnSubmit(Message.SubmittedForm())],
							[
								dialogBody(
									h,
									botFormFields(h, {
										id: ID,
										form: model,
										onName: (value) => Message.ChangedName({ value }),
										onDescription: (value) => Message.ChangedDescription({ value }),
										onToggleScope: (scope) => Message.ToggledScope({ scope }),
										onPublic: (isSelected) => Message.ToggledPublic({ isSelected }),
									}),
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
										[model.isSubmitting ? "Creating..." : "Create Application"],
									),
								]),
							],
						),
					],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"CreateBot",
	{ request: Requests.CreateBot, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame(ID),
				...initBotForm({ name: "", description: "", scopes: ["messages:read", "messages:write"], isPublic: false }),
				createdBotToken: null,
				createdBotName: "",
				isTokenVisible: false,
			},
		}),
		update,
		view,
	},
)
