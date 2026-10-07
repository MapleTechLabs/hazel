import { ChannelId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../rpc"
import type { Shared } from "../../contract"
import { Message, type Model, type PageReturn } from "./model"

/** `ChatRouteContent`'s mount effect: clear the channel's notifications once per visit. */

export const ClearChannelNotifications = Command.define("ClearChannelNotifications", {
	args: { channelId: ChannelId },
	messages: [Message.SucceededClearNotifications, Message.FailedClearNotifications],
	execute: ({ channelId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			yield* client("channelMember.clearNotifications", { channelId })
			return Message.SucceededClearNotifications()
		}).pipe(
			Effect.catch((error) =>
				Effect.succeed(Message.FailedClearNotifications({ reason: String(error) })),
			),
		),
})

/** The route content mounts inside the signed-in, loaded org layout (`_app` and `$orgSlug` gates). */
const isMounted = (shared: Shared) =>
	shared.auth === "SignedIn" && shared.currentUser !== null && shared.organization !== null

export const clearNotificationsOnMount = (model: Model, shared: Shared): PageReturn =>
	model.hasClearedNotifications || !isMounted(shared)
		? { model }
		: {
				model: modifyFields(model, { hasClearedNotifications: () => true }),
				commands: [ClearChannelNotifications({ channelId: model.channelId })],
			}
