import { BotId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { twMerge } from "tailwind-merge"
import { dialogDescriptionBase } from "~/components/ui/dialog.styles"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../rpc"
import { button } from "../../ui/button"
import { dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed, completed, ModalOutMessage } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"
import { failureToast, successToast } from "../../data/actions"

/**
 * The delete-confirm modal of `components/bots/bot-card.tsx` (`bot.delete`). The legacy `onDelete`
 * and `reactivityKeys` (refresh the apps list) are not ported.
 */

const Model = Schema.Struct({
	frame: Frame,
	botId: BotId,
	botName: Schema.String,
	isDeleting: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedCancel: {},
	ClickedDelete: {},
	SucceededDeleteBot: {},
	FailedDeleteBot: { toast: ToastRequest },
})
type Message = typeof Message.Type

const errorOverrides = {
	BotNotFoundError: {
		title: "Application not found",
		description: "This application may have already been deleted.",
		isRetryable: false,
	},
}

const DeleteBot = Command.define("DeleteBot", {
	args: { id: BotId },
	messages: [Message.SucceededDeleteBot, Message.FailedDeleteBot],
	execute: (payload) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("bot.delete", payload)
			return Message.SucceededDeleteBot()
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed(Message.FailedDeleteBot({ toast: failureToast(cause, "friendly", errorOverrides) })),
			),
		),
})

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedDelete: () =>
			model.isDeleting
				? { model }
				: { model: modifyFields(model, { isDeleting: () => true }), commands: [DeleteBot({ id: model.botId })] },
		SucceededDeleteBot: () => ({
			model,
			outMessage: completed({ toast: successToast("Application deleted successfully") }),
		}),
		FailedDeleteBot: ({ toast }) => ({
			model: modifyFields(model, { isDeleting: () => false }),
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{},
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Delete Application"),
				// Three text nodes, as React renders the interpolated JSX.
				h.p(
					[h.Attribute("data-slot", "description"), h.Class(twMerge(dialogDescriptionBase))],
					['Are you sure you want to delete "', model.botName, '"? This action cannot be undone.'],
				),
			]),
			dialogFooter(h, [
				button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.ClickedDelete(), isDisabled: model.isDeleting }, [
					model.isDeleting ? "Deleting..." : "Delete Application",
				]),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"DeleteBot",
	{ request: Requests.DeleteBot, Model, Message },
	{
		init: ({ botId, botName }) => ({
			model: { frame: initFrame("delete-bot-modal"), botId, botName, isDeleting: false },
		}),
		update,
		view,
	},
)
