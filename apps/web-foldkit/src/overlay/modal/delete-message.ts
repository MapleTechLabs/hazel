import { MessageId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { deleteMessageAction } from "~/db/actions"
import { IconWarning } from "../../icons"
import { button } from "../../ui/button"
import { dialogFooter, dialogHeader } from "../../ui/dialog"
import { closed } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, Message as FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"
import { runAtomFn } from "../../data/actions"

/** `components/chat/delete-message-modal.tsx`; confirming runs the toolbar's `deleteMessageAction`. */

const Model = Schema.Struct({ messageId: MessageId, frame: Frame })
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedCancel: {},
	ClickedDelete: {},
	CompletedDeleteMessage: {},
})
type Message = typeof Message.Type

const DeleteMessage = Command.define("DeleteMessage", {
	args: { messageId: MessageId },
	messages: [Message.CompletedDeleteMessage],
	// Legacy `handleDelete` fires the action without a toast either way.
	execute: ({ messageId }) =>
		runAtomFn(deleteMessageAction, { messageId }).pipe(
			Effect.ignoreCause,
			Effect.as(Message.CompletedDeleteMessage()),
		),
})

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) => (isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model }),
		ClickedCancel: () => ({ model, outMessage: closed }),
		// Legacy `handleDelete`: fire the action and close at once.
		ClickedDelete: () => ({ model, commands: [DeleteMessage({ messageId: model.messageId })], outMessage: closed }),
		CompletedDeleteMessage: () => ({ model }),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "md" },
		() => [
			dialogHeader(h, {}, [
				h.div(
					[h.Class("flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5")],
					[IconWarning(h, { className: "size-6 text-danger" })],
				),
				modalTitle(h, model.frame, "Delete message"),
				modalDescription(h, "Are you sure you want to delete this message? This action cannot be undone."),
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
