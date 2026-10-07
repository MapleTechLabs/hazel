import { InternalServerError } from "@hazel/domain"
import {
	BotAlreadyInstalledError,
	BotNotFoundError,
	ChannelNotFoundError,
	ConnectInviteInvalidStateError,
	ConnectInviteNotFoundError,
	CustomEmojiNotFoundError,
} from "@hazel/domain/rpc"
import { Effect } from "effect"
import type { Dataset } from "../dataset.ts"
import { integrationsDataset } from "./integrations.ts"

/**
 * The rich workspace where selected RPCs fail with their real typed errors, to capture
 * error states and error toasts. Reads not listed here still succeed.
 */
type Payload = Record<string, string>
const payloadOf = (payload: unknown) => payload as Payload

export const errorsDataset: Dataset = {
	...integrationsDataset,
	name: "errors",
	rpc: {
		...integrationsDataset.rpc,
		"chatSync.connection.list": () =>
			Effect.fail(new InternalServerError({ message: "Chat sync is unavailable" })),
		"channelWebhook.list": (payload) =>
			Effect.fail(new ChannelNotFoundError({ channelId: payloadOf(payload).channelId as never })),
		"channel.update": (payload) =>
			Effect.fail(new ChannelNotFoundError({ channelId: payloadOf(payload).id as never })),
		"customEmoji.delete": (payload) =>
			Effect.fail(new CustomEmojiNotFoundError({ customEmojiId: payloadOf(payload).id as never })),
		"connectShare.invite.accept": (payload) =>
			Effect.fail(
				new ConnectInviteInvalidStateError({
					inviteId: payloadOf(payload).inviteId as never,
					status: "expired",
					message: "Invite expired",
				}),
			),
		"connectShare.invite.revoke": (payload) =>
			Effect.fail(
				new ConnectInviteNotFoundError({
					inviteId: payloadOf(payload).inviteId as never,
					message: "Invite not found",
				}),
			),
		"bot.install": (payload) =>
			Effect.fail(new BotAlreadyInstalledError({ botId: payloadOf(payload).botId as never })),
		"bot.installById": (payload) =>
			Effect.fail(new BotNotFoundError({ botId: payloadOf(payload).botId as never })),
		"bot.uninstall": (payload) =>
			Effect.fail(new BotNotFoundError({ botId: payloadOf(payload).botId as never })),
	},
}
