/**
 * What an outbound chat-sync delivery calls: the provider's adapter (bot API) and Discord's
 * webhook API (per-author identity), plus where attachments are publicly served. Part of every
 * object's platform; a `ChannelObject`'s outbox uses it (`chat-sync-outbound.ts`).
 */
import { Discord } from "@hazel/integrations"
import type { ExternalChannelId, ExternalMessageId } from "@hazel/schema"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import {
	ChatSyncProviderApiError,
	type ChatSyncProviderAdapter,
	ChatSyncProviderConfigurationError,
	type ChatSyncProviderNotSupportedError,
	ChatSyncProviderRegistry,
} from "./chat-sync-provider-registry"

export interface DiscordWebhookTarget {
	readonly webhookId: string
	readonly webhookToken: string
}

export interface ChatSyncTransportShape {
	readonly adapter: (
		provider: string,
	) => Effect.Effect<ChatSyncProviderAdapter, ChatSyncProviderNotSupportedError>
	readonly discordWebhooks: {
		readonly create: (
			externalChannelId: ExternalChannelId,
		) => Effect.Effect<
			DiscordWebhookTarget,
			ChatSyncProviderApiError | ChatSyncProviderConfigurationError
		>
		readonly execute: (
			params: DiscordWebhookTarget & {
				readonly content: string
				readonly replyToExternalMessageId?: ExternalMessageId
				readonly username: string
				readonly avatarUrl?: string
			},
		) => Effect.Effect<ExternalMessageId, ChatSyncProviderApiError>
		readonly update: (
			params: DiscordWebhookTarget & {
				readonly messageId: ExternalMessageId
				readonly content: string
			},
		) => Effect.Effect<void, ChatSyncProviderApiError>
		readonly delete: (
			params: DiscordWebhookTarget & { readonly messageId: ExternalMessageId },
		) => Effect.Effect<void, ChatSyncProviderApiError>
	}
	/** `S3_PUBLIC_URL`: attachments are linked as `<base>/<attachmentId>`. */
	readonly attachmentPublicUrlBase: Option.Option<string>
}

/** Discord's answer, or a transport failure or timeout (no status: retryable). */
const apiError = (error: { readonly _tag: string; readonly message: string; readonly status?: number }) => {
	const status = error._tag === "DiscordApiError" ? error.status : undefined
	return new ChatSyncProviderApiError({
		provider: "discord",
		message: error.message,
		status,
		detail: `discord_api_status_${status ?? "unknown"}`,
	})
}

export class ChatSyncTransport extends Context.Service<ChatSyncTransport, ChatSyncTransportShape>()(
	"@hazel/backend/ChatSyncTransport",
) {
	/** Discord's REST API over fetch; reads `DISCORD_BOT_TOKEN` and `S3_PUBLIC_URL`. */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const registry = yield* ChatSyncProviderRegistry
			const discord = yield* Discord.DiscordApiClient
			const botToken = yield* Config.Redacted("DISCORD_BOT_TOKEN").pipe(Config.option)
			const publicUrl = yield* Config.String("S3_PUBLIC_URL").pipe(Config.option)
			return ChatSyncTransport.of({
				adapter: registry.getAdapter,
				discordWebhooks: {
					create: (externalChannelId) =>
						Option.match(botToken, {
							onNone: () =>
								Effect.fail(
									new ChatSyncProviderConfigurationError({
										provider: "discord",
										message: "DISCORD_BOT_TOKEN is not configured",
									}),
								),
							onSome: (token) =>
								discord
									.createWebhook({
										channelId: externalChannelId,
										botToken: Redacted.value(token),
									})
									.pipe(Effect.mapError(apiError)),
						}),
					execute: (params) =>
						discord.executeWebhookMessage(params).pipe(
							Effect.map((id) => id as ExternalMessageId),
							Effect.mapError(apiError),
						),
					update: ({ messageId, ...params }) =>
						discord
							.updateWebhookMessage({ ...params, webhookMessageId: messageId })
							.pipe(Effect.asVoid, Effect.mapError(apiError)),
					delete: ({ messageId, ...params }) =>
						discord
							.deleteWebhookMessage({ ...params, webhookMessageId: messageId })
							.pipe(Effect.asVoid, Effect.mapError(apiError)),
				},
				attachmentPublicUrlBase: Option.filter(
					Option.map(publicUrl, (url) => url.trim()),
					(url) => url.length > 0,
				),
			})
		}),
	).pipe(Layer.provide(ChatSyncProviderRegistry.layer), Layer.provide(Discord.DiscordApiClient.layer))
}

/** One provider call a recording transport saw. */
export interface ChatSyncCall {
	readonly op: string
	readonly externalChannelId?: string
	readonly externalMessageId?: string
	readonly content?: string
	readonly emoji?: string
	readonly username?: string
}

/**
 * For tests: a transport that records every call and answers with fresh external ids. Set
 * `fail` to make calls fail (with that status) until it is cleared.
 */
export const makeRecordingChatSyncTransport = (options?: { readonly attachmentPublicUrlBase?: string }) => {
	const calls: Array<ChatSyncCall> = []
	const control: { fail: number | undefined } = { fail: undefined }
	let counter = 0
	const nextId = () => `${900000000000000000 + ++counter}` as ExternalMessageId
	const record = <A>(call: ChatSyncCall, value: () => A) =>
		Effect.suspend(() => {
			if (control.fail !== undefined) {
				return Effect.fail(
					new ChatSyncProviderApiError({
						provider: "discord",
						message: `${call.op} failed`,
						status: control.fail,
					}),
				)
			}
			calls.push(call)
			return Effect.succeed(value())
		})

	const adapter: ChatSyncProviderAdapter = {
		provider: "discord",
		createMessage: (params) =>
			record(
				{ op: "createMessage", externalChannelId: params.externalChannelId, content: params.content },
				nextId,
			),
		createMessageWithAttachments: (params) =>
			record(
				{
					op: "createMessageWithAttachments",
					externalChannelId: params.externalChannelId,
					content: params.content,
				},
				nextId,
			),
		updateMessage: (params) =>
			record(
				{
					op: "updateMessage",
					externalChannelId: params.externalChannelId,
					externalMessageId: params.externalMessageId,
					content: params.content,
				},
				() => undefined,
			),
		deleteMessage: (params) =>
			record(
				{
					op: "deleteMessage",
					externalChannelId: params.externalChannelId,
					externalMessageId: params.externalMessageId,
				},
				() => undefined,
			),
		addReaction: (params) =>
			record(
				{
					op: "addReaction",
					externalChannelId: params.externalChannelId,
					externalMessageId: params.externalMessageId,
					emoji: params.emoji,
				},
				() => undefined,
			),
		removeReaction: (params) =>
			record(
				{
					op: "removeReaction",
					externalChannelId: params.externalChannelId,
					externalMessageId: params.externalMessageId,
					emoji: params.emoji,
				},
				() => undefined,
			),
		createThread: (params) =>
			record(
				{
					op: "createThread",
					externalChannelId: params.externalChannelId,
					externalMessageId: params.externalMessageId,
					content: params.name,
				},
				() => nextId() as never,
			),
	}

	const layer = Layer.succeed(
		ChatSyncTransport,
		ChatSyncTransport.of({
			adapter: () => Effect.succeed(adapter),
			discordWebhooks: {
				create: (externalChannelId) =>
					record({ op: "createWebhook", externalChannelId }, () => ({
						webhookId: `${800000000000000000 + ++counter}`,
						webhookToken: "token",
					})),
				execute: (params) =>
					record(
						{ op: "executeWebhook", content: params.content, username: params.username },
						nextId,
					),
				update: (params) =>
					record(
						{
							op: "updateWebhookMessage",
							externalMessageId: params.messageId,
							content: params.content,
						},
						() => undefined,
					),
				delete: (params) =>
					record(
						{ op: "deleteWebhookMessage", externalMessageId: params.messageId },
						() => undefined,
					),
			},
			attachmentPublicUrlBase: Option.fromNullishOr(options?.attachmentPublicUrlBase),
		}),
	)

	return { layer, calls, control }
}
