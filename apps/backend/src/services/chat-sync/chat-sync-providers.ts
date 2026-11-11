/**
 * The provider clients an outbound chat-sync delivery calls, plus where attachments are publicly
 * served. Part of every object's platform; a `ChannelObject`'s outbox uses it
 * (`chat-sync-outbound.ts`).
 */
import { Discord, Slack } from "@hazel/integrations"
import { Config, Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import {
	type ChatSyncClient,
	type ChatSyncProviderDefinition,
	type ChatSyncProviderId,
	ChatSyncProviderNotSupportedError,
	isChatSyncProviderId,
} from "./provider"
import { chatSyncProviders } from "./providers"
import { ChatSyncInstallations } from "./chat-sync-installations"
import { makeDiscordClient } from "./providers/discord/client"
import { makeSlackClient } from "./providers/slack/client"

/** A provider this build syncs with: its definition and its client. */
export interface ChatSyncProvider {
	readonly definition: ChatSyncProviderDefinition
	readonly client: ChatSyncClient
}

export interface ChatSyncProvidersShape {
	readonly get: (provider: string) => Effect.Effect<ChatSyncProvider, ChatSyncProviderNotSupportedError>
	/** `S3_PUBLIC_URL`: attachments are linked as `<base>/<attachmentId>`. */
	readonly attachmentPublicUrlBase: Option.Option<string>
}

/** The shape over a client per provider. */
export const chatSyncProvidersOf = (
	clients: Partial<Record<ChatSyncProviderId, ChatSyncClient>>,
	attachmentPublicUrlBase: Option.Option<string>,
): ChatSyncProvidersShape => ({
	get: (provider) => {
		const client = isChatSyncProviderId(provider) ? clients[provider] : undefined
		return client === undefined
			? Effect.fail(new ChatSyncProviderNotSupportedError({ provider }))
			: Effect.succeed({ definition: chatSyncProviders[provider as ChatSyncProviderId], client })
	},
	attachmentPublicUrlBase,
})

export class ChatSyncProviders extends Context.Service<ChatSyncProviders, ChatSyncProvidersShape>()(
	"@hazel/backend/ChatSyncProviders",
) {
	/**
	 * The providers' APIs over fetch; reads Discord's token and `S3_PUBLIC_URL`, and Slack's
	 * per-workspace tokens from the globally provided `Directory`.
	 */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const publicUrl = yield* Config.String("S3_PUBLIC_URL").pipe(Config.option)
			return chatSyncProvidersOf(
				{ discord: yield* makeDiscordClient, slack: yield* makeSlackClient },
				Option.filter(
					Option.map(publicUrl, (url) => url.trim()),
					(url) => url.length > 0,
				),
			)
		}),
	).pipe(
		Layer.provide(
			Layer.mergeAll(
				Discord.DiscordApiClient.layer,
				Slack.SlackApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
				ChatSyncInstallations.layer,
			),
		),
	)
}
