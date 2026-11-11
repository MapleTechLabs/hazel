import { ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { deleteChannelAction } from "~/db/actions"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import { catchCommon, errorToastOf, successToast } from "../../data/actions"
import { AppRoute } from "../../route"
import { button } from "../../ui/button"
import { dialogFooter, dialogHeader } from "../../ui/dialog"
import { description } from "../../ui/field"
import { closed, completed, ModalOutMessage } from "../out-message"
import * as Requests from "./requests"
import { defineModal, type ModalContext, type ModalReturn, type ModalViewInputs } from "./contract"
import { Frame, Message as FrameMessage, frameView, initFrame, isCloseRequest, modalTitle } from "./frame"

/** `components/modals/delete-channel-modal.tsx`; confirming runs `deleteChannelAction`. */

const Model = Schema.Struct({ channelId: ChannelId, channelName: Schema.String, frame: Frame })
type Model = typeof Model.Type

/** What can go wrong deleting a channel, beyond the shared reasons. */
export const DeleteChannelFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type DeleteChannelFailure = typeof DeleteChannelFailure.Type

export const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ClickedCancel: {},
	ClickedDelete: {},
	SucceededDeleteChannel: {},
	FailedDeleteChannel: { reason: DeleteChannelFailure },
})
type Message = typeof Message.Type

export const DeleteChannel = Command.define("DeleteChannel", {
	args: { channelId: ChannelId },
	messages: [Message.SucceededDeleteChannel, Message.FailedDeleteChannel],
	execute: ({ channelId }) =>
		deleteChannelAction({ channelId }).pipe(
			Effect.as(Message.SucceededDeleteChannel()),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedDeleteChannel({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedDeleteChannel({ reason })),
		),
})

/** Legacy fuzzy `matchRoute` on `/$orgSlug/chat/$id` or `/$orgSlug/channels/$channelId/settings`. */
const isChannelRoute = AppRoute.isAnyOf([
	"ChatChannel",
	"ChatFiles",
	"ChatFilesMedia",
	"ChannelSettings",
	"ChannelSettingsOverview",
	"ChannelSettingsIntegrations",
	"ChannelSettingsConnect",
])

const isOnChannel = (route: AppRoute, channelId: ChannelId) =>
	isChannelRoute(route) && route.channelId === channelId

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message, context: ModalContext): Return =>
	Message.match<Return>(message, {
		GotFrameMessage: ({ message }) =>
			isCloseRequest(message) ? { model, outMessage: closed } : { model },
		ClickedCancel: () => ({ model, outMessage: closed }),
		ClickedDelete: () => ({ model, commands: [DeleteChannel({ channelId: model.channelId })] }),
		// Leave the deleted channel's pages for the chat index (the route is read when the result lands).
		SucceededDeleteChannel: () => ({
			model,
			outMessage: completed({
				...(context.orgSlug !== null && isOnChannel(context.route, model.channelId)
					? { route: AppRoute.ChatIndex({ orgSlug: context.orgSlug }) }
					: {}),
				toast: successToast("Channel deleted successfully"),
			}),
		}),
		FailedDeleteChannel: ({ reason }) => ({
			model,
			outMessage: ModalOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Channel not found",
							description: "This channel may have already been deleted.",
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
	{ request: Requests.DeleteChannel, Model, Message },
	{
		init: ({ channelId, channelName }) => ({
			model: { channelId, channelName, frame: initFrame("delete-channel-modal") },
		}),
		update,
		view,
	},
)
