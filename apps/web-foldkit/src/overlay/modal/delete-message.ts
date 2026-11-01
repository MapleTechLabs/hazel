import { MessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { deleteMessageAction } from "~/db/actions"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf } from "../../data/actions"
import { IconWarning } from "../../icons"
import { button } from "../../ui/button"
import { dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed, ModalOutMessage } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import {
	Frame,
	Message as FrameMessage,
	frameView,
	initFrame,
	isCloseRequest,
	modalDescription,
	modalTitle,
} from "./frame"

/**
 * `components/chat/delete-message-modal.tsx`; confirming runs the toolbar's `deleteMessageAction`.
 * The modal closes at once, so a failure arrives at the closed instance and still toasts.
 */

const Model = Schema.Struct({ messageId: MessageId, frame: Frame })
type Model = typeof Model.Type

/** What can go wrong deleting a message, beyond the shared reasons. */
export const DeleteMessageFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type DeleteMessageFailure = typeof DeleteMessageFailure.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedCancel: {},
	ClickedDelete: {},
	SucceededDeleteMessage: {},
	FailedDeleteMessage: { reason: DeleteMessageFailure },
})
type Message = typeof Message.Type

export const DeleteMessage = Command.define("DeleteMessage", {
	args: { messageId: MessageId },
	messages: [Message.SucceededDeleteMessage, Message.FailedDeleteMessage],
	execute: ({ messageId }) =>
		deleteMessageAction({ messageId }).pipe(
			Effect.as(Message.SucceededDeleteMessage()),
			Effect.catchTags({
				MessageNotFoundError: () =>
					Effect.succeed(Message.FailedDeleteMessage({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedDeleteMessage({ reason })),
		),
})

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ClickedCancel: () => ({ model, outMessage: closed }),
		// Legacy `handleDelete`: fire the action and close at once.
		ClickedDelete: () => ({
			model,
			commands: [DeleteMessage({ messageId: model.messageId })],
			outMessage: closed,
		}),
		// The optimistic delete already removed it; legacy shows no success toast.
		SucceededDeleteMessage: () => ({ model }),
		// The optimistic delete rolled back: say why the message came back.
		FailedDeleteMessage: ({ reason }) => ({
			model,
			outMessage: ModalOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Message not found",
							description: "It may have already been deleted.",
						},
					}),
				),
			}),
		}),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "md" },
		() => [
			dialogHeader(h, {}, [
				h.div(
					[
						h.Class(
							"flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5",
						),
					],
					[IconWarning(h, { className: "size-6 text-danger" })],
				),
				modalTitle(h, model.frame, "Delete message"),
				modalDescription(
					h,
					"Are you sure you want to delete this message? This action cannot be undone.",
				),
			]),
			dialogFooter(h, [
				button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.ClickedDelete() }, ["Delete message"]),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"DeleteMessage",
	{ request: Requests.DeleteMessage, Model, Message },
	{
		init: ({ messageId }) => ({ model: { messageId, frame: initFrame("delete-message") } }),
		update,
		view,
	},
)
