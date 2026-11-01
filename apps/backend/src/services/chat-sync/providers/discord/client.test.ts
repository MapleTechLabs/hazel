import { describe, expect, it } from "@effect/vitest"
import { Discord } from "@hazel/integrations"
import {
	ExternalChannelId,
	ExternalMessageId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
} from "@hazel/schema"
import { ConfigProvider, Effect, Layer } from "effect"
import type { ChatSyncLinkContext } from "../../provider"
import { makeDiscordClient } from "./client"

const channelId = ExternalChannelId.make("100000000000000001")
const messageId = ExternalMessageId.make("100000000000000002")

const context: ChatSyncLinkContext = {
	link: {
		channelLinkId: SyncChannelLinkId.make(crypto.randomUUID()),
		syncConnectionId: SyncConnectionId.make(crypto.randomUUID()),
		organizationId: OrganizationId.make(crypto.randomUUID()),
		provider: "discord",
		externalChannelId: channelId,
		direction: "both",
		settings: null,
	},
	saveSettings: () => Effect.void,
}

const registryWith = (createThread: () => Effect.Effect<string, Discord.DiscordApiError>) =>
	Layer.mergeAll(
		Layer.succeed(Discord.DiscordApiClient, {
			createThread,
		} as unknown as Discord.DiscordApiClient["Service"]),
		ConfigProvider.layer(ConfigProvider.fromUnknown({ DISCORD_BOT_TOKEN: "bot-token" })),
	)

const createThread = Effect.gen(function* () {
	const client = yield* makeDiscordClient
	return yield* client.createThread(context, { externalMessageId: messageId, name: "Hi" })
})

describe("Discord thread creation", () => {
	it.effect("returns the thread Discord made", () =>
		createThread.pipe(
			Effect.map((threadId) => expect(threadId).toBe("100000000000000003")),
			Effect.provide(registryWith(() => Effect.succeed("100000000000000003"))),
		),
	)

	it.effect("a retry after the thread was made takes the existing one (the message's id)", () =>
		createThread.pipe(
			Effect.map((threadId) => expect(threadId).toBe(messageId)),
			Effect.provide(
				registryWith(() =>
					Effect.fail(
						new Discord.DiscordApiError({
							message: "A thread has already been created for this message",
							status: 400,
							code: Discord.DISCORD_THREAD_ALREADY_CREATED,
						}),
					),
				),
			),
		),
	)

	it.effect("other refusals still fail", () =>
		createThread.pipe(
			Effect.flip,
			Effect.map((error) => expect(error._tag).toBe("ChatSyncProviderApiError")),
			Effect.provide(
				registryWith(() =>
					Effect.fail(new Discord.DiscordApiError({ message: "Missing Access", status: 403 })),
				),
			),
		),
	)
})
