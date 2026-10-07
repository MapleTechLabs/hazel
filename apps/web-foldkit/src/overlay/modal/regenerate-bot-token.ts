import { BotId } from "@hazel/schema"
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
import { botTokenDisplay } from "./bot-token-display"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/** The regenerate-confirm modal of `components/bots/bot-card.tsx` (`bot.regenerateToken`). */

const Model = Schema.Struct({
	frame: Frame,
	botId: BotId,
	botName: Schema.String,
	isRegenerating: Schema.Boolean,
	token: Schema.NullOr(Schema.String),
	isTokenVisible: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedCancel: {},
	ClickedDone: {},
	ClickedRegenerate: {},
	SucceededRegenerateToken: { token: Schema.String },
	FailedRegenerateToken: { toast: ToastRequest },
	ClickedToggleTokenVisible: {},
	ClickedCopyToken: {},
	SucceededCopyToken: {},
	FailedCopyToken: {},
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

const RegenerateToken = Command.define("RegenerateToken", {
	args: { id: BotId },
	messages: [Message.SucceededRegenerateToken, Message.FailedRegenerateToken],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("bot.regenerateToken", payload)
			return Message.SucceededRegenerateToken({ token: result.token })
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(Message.FailedRegenerateToken({ toast: toastForCause(cause, errorOverrides) })),
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

const toast = (request: ToastRequest) => ModalOutMessage.RequestedToast({ toast: request })

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedDone: () => ({ model, outMessage: closed }),
		ClickedRegenerate: () =>
			model.isRegenerating
				? { model }
				: {
						model: modifyFields(model, { isRegenerating: () => true }),
						commands: [RegenerateToken({ id: model.botId })],
					},
		SucceededRegenerateToken: ({ token }) => ({
			model: modifyFields(model, { isRegenerating: () => false, token: () => token }),
			outMessage: toast(successToast("Token regenerated successfully")),
		}),
		FailedRegenerateToken: ({ toast: request }) => ({
			model: modifyFields(model, { isRegenerating: () => false }),
			outMessage: toast(request),
		}),
		ClickedToggleTokenVisible: () => ({ model: modifyFields(model, { isTokenVisible: (value) => !value }) }),
		ClickedCopyToken: () => (model.token === null ? { model } : { model, commands: [CopyToken({ token: model.token })] }),
		SucceededCopyToken: () => ({ model, outMessage: toast(successToast("Token copied to clipboard")) }),
		FailedCopyToken: () => ({ model, outMessage: toast(errorToast("Failed to copy token")) }),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, model.token !== null ? "New Token Generated" : "Regenerate Token"),
				dialogDescription(
					h,
					model.token !== null
						? "Save this new token now. The old token has been invalidated."
						: "This will invalidate the current token. The application will need to be updated with the new token.",
				),
			]),
			dialogBody(h, [
				model.token !== null
					? botTokenDisplay(h, {
							token: model.token,
							isVisible: model.isTokenVisible,
							onToggleVisible: Message.ClickedToggleTokenVisible(),
							onCopy: Message.ClickedCopyToken(),
						})
					: h.p(
							[h.Class("text-muted-fg text-sm")],
							["Any applications using the current token will stop working immediately."],
						),
			]),
			dialogFooter(
				h,
				model.token !== null
					? [button(h, { intent: "primary", onPress: Message.ClickedDone() }, ["Done"])]
					: [
							button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
							button(
								h,
								{ intent: "danger", onPress: Message.ClickedRegenerate(), isDisabled: model.isRegenerating },
								[model.isRegenerating ? "Regenerating..." : "Regenerate Token"],
							),
						],
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"RegenerateBotToken",
	{ request: Requests.RegenerateBotToken, Model, Message },
	{
		init: ({ botId, botName }) => ({
			model: {
				frame: initFrame("regenerate-bot-token-modal"),
				botId,
				botName,
				isRegenerating: false,
				token: null,
				isTokenVisible: false,
			},
		}),
		update,
		view,
	},
)
