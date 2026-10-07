import { ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { deleteChannelAction } from "~/db/actions"
import type { Shared } from "../../page/contract"
import { button } from "../../ui/button"
import { dialogFooter, dialogHeader } from "../../ui/dialog"
import { description } from "../../ui/field"
import { runAction, toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import { defineModal, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalTitle } from "./frame"

/** `components/modals/delete-channel-modal.tsx`; confirming runs `deleteChannelAction`. */

const Model = Schema.Struct({ channelId: ChannelId, channelName: Schema.String, frame: Frame })
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedCancel: {},
	ClickedDelete: {},
	SucceededDeleteChannel: { isOnDeletedChannel: Schema.Boolean },
	FailedDeleteChannel: { toast: ToastRequest },
})
type Message = typeof Message.Type

/** Legacy fuzzy `matchRoute` on `/$orgSlug/chat/$id` or `/$orgSlug/channels/$channelId/settings`. */
const isUnder = (pathname: string, base: string) =>
	pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`)

const DeleteChannel = Command.define("DeleteChannel", {
	args: { channelId: ChannelId, orgSlug: Schema.String },
	messages: [Message.SucceededDeleteChannel, Message.FailedDeleteChannel],
	execute: ({ channelId, orgSlug }) =>
		runAction(deleteChannelAction, { channelId }).pipe(
			Effect.andThen(() =>
				Effect.sync(() => {
					const pathname = window.location.pathname
					return Message.SucceededDeleteChannel({
						isOnDeletedChannel:
							isUnder(pathname, `/${orgSlug}/chat/${channelId}`) ||
							isUnder(pathname, `/${orgSlug}/channels/${channelId}/settings`),
					})
				}),
			),
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedDeleteChannel({
						toast: toastForCause(cause, {
							ChannelNotFoundError: {
								title: "Channel not found",
								description: "This channel may have already been deleted.",
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isFrameClosed(model.frame, message) ? { model, outMessage: closed } : { model },
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedDelete: () => ({
			model,
			commands: [DeleteChannel({ channelId: model.channelId, orgSlug: shared.orgSlug ?? "" })],
		}),
		SucceededDeleteChannel: ({ isOnDeletedChannel }) => ({
			model,
			outMessage: completed({
				...(isOnDeletedChannel ? { href: `/${shared.orgSlug ?? ""}/chat` } : {}),
				toast: successToast("Channel deleted successfully"),
			}),
		}),
		FailedDeleteChannel: ({ toast }) => ({
			model,
			outMessage: ModalOutMessage.RequestedToast({ toast }),
		}),
	})

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Delete channel"),
				description(h, {}, [
					"Are you sure you want to delete ",
					h.strong([], [`#${model.channelName}`]),
					"? This action cannot be undone and all messages will be permanently deleted.",
				]),
			]),
			dialogFooter(h, [
				button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
				button(h, { intent: "danger", onPress: Message.ClickedDelete() }, ["Delete"]),
			]),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)

export const modal = defineModal(
	"DeleteChannel",
	{ request: { channelId: ChannelId, channelName: Schema.String }, Model, Message },
	{
		init: ({ channelId, channelName }) => ({
			model: { channelId, channelName, frame: initFrame("delete-channel-modal") },
		}),
		update,
		view,
	},
)
