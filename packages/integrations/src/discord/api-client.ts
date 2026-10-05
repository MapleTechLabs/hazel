import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"
import { Context, Duration, Effect, Layer, Result, Schema } from "effect"

export const DiscordAccountInfo = Schema.Struct({
	externalAccountId: Schema.String,
	externalAccountName: Schema.String,
})

export type DiscordAccountInfo = typeof DiscordAccountInfo.Type

export const DiscordGuild = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
	owner: Schema.Boolean,
})

export type DiscordGuild = typeof DiscordGuild.Type

export const DiscordGuildChannel = Schema.Struct({
	id: Schema.String,
	guildId: Schema.String,
	name: Schema.String,
	type: Schema.Number,
	parentId: Schema.NullOr(Schema.String),
})

export type DiscordGuildChannel = typeof DiscordGuildChannel.Type

const DiscordUserApiResponse = Schema.Struct({
	id: Schema.String,
	username: Schema.String,
	global_name: Schema.optional(Schema.NullOr(Schema.String)),
	discriminator: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("0"))),
})

const DiscordGuildApiResponse = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	icon: Schema.optional(Schema.NullOr(Schema.String)),
	owner: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
})

const DiscordWebhookCreateResponse = Schema.Struct({
	id: Schema.String,
	token: Schema.String,
})

const DiscordGuildChannelApiResponse = Schema.Struct({
	id: Schema.String,
	guild_id: Schema.String,
	name: Schema.String,
	type: Schema.Number,
	parent_id: Schema.optional(Schema.NullOr(Schema.String)),
})

const DiscordMessageCreateResponse = Schema.Struct({
	id: Schema.String,
})

const DiscordErrorApiResponse = Schema.Struct({
	message: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("Unknown Discord error"))),
})

export class DiscordApiError extends Schema.TaggedError<DiscordApiError>()("DiscordApiError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

const DISCORD_API_BASE_URL = "https://discord.com/api/v10"
const DEFAULT_TIMEOUT = Duration.seconds(30)

const parseDiscordErrorMessage = (status: number, message: string): string => {
	if (status === 401 || status === 403) {
		return "Discord authentication failed"
	}
	if (status === 429) {
		return "Discord rate limit exceeded"
	}
	if (status >= 500) {
		return "Discord service is temporarily unavailable"
	}
	return message
}

const channelTypeIsMessageCapable = (type: number): boolean =>
	type === 0 || type === 5 || type === 10 || type === 11 || type === 12

export class DiscordApiClient extends Context.Service<DiscordApiClient>()("DiscordApiClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		const makeBearerClient = (token: string) =>
			httpClient.pipe(
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
					}),
				),
			)

		const makeBotClient = (botToken: string) =>
			httpClient.pipe(
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						Authorization: `Bot ${botToken}`,
						Accept: "application/json",
					}),
				),
			)

		const handleApiError = Effect.fn("DiscordApiClient.handleApiError")(function* (response: {
			status: number
			json: Effect.Effect<unknown, unknown, never>
		}) {
			const bodyResult = yield* response.json.pipe(Effect.result)
			const message = Result.isSuccess(bodyResult)
				? (() => {
						const decoded = Schema.decodeUnknownSync(DiscordErrorApiResponse)(bodyResult.success)
						return parseDiscordErrorMessage(
							response.status,
							decoded.message ?? "Unknown Discord error",
						)
					})()
				: `Discord API request failed with status ${response.status}`

			return yield* Effect.fail(
				new DiscordApiError({
					message,
					status: response.status,
				}),
			)
		})

		const getAccountInfo = Effect.fn("DiscordApiClient.getAccountInfo")(function* (accessToken: string) {
			const response = yield* makeBearerClient(accessToken)
				.get(`${DISCORD_API_BASE_URL}/users/@me`)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(DiscordUserApiResponse)),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord account info response",
							cause,
						}),
				),
			)

			const displayName =
				body.global_name ??
				(body.discriminator === "0" ? body.username : `${body.username}#${body.discriminator}`)

			return {
				externalAccountId: body.id,
				externalAccountName: displayName,
			} satisfies DiscordAccountInfo
		})

		const listGuilds = Effect.fn("DiscordApiClient.listGuilds")(function* (accessToken: string) {
			const response = yield* makeBearerClient(accessToken)
				.get(`${DISCORD_API_BASE_URL}/users/@me/guilds`)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(DiscordGuildApiResponse))),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord guilds response",
							cause,
						}),
				),
			)

			return body.map(
				(guild): DiscordGuild => ({
					id: guild.id,
					name: guild.name,
					icon: guild.icon ?? null,
					owner: guild.owner,
				}),
			)
		})

		const listGuildChannels = Effect.fn("DiscordApiClient.listGuildChannels")(function* (
			guildId: string,
			botToken: string,
		) {
			const response = yield* makeBotClient(botToken)
				.get(`${DISCORD_API_BASE_URL}/guilds/${guildId}/channels`)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(DiscordGuildChannelApiResponse))),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord channels response",
							cause,
						}),
				),
			)

			return body
				.filter((channel) => channelTypeIsMessageCapable(channel.type))
				.map(
					(channel): DiscordGuildChannel => ({
						id: channel.id,
						guildId: channel.guild_id,
						name: channel.name,
						type: channel.type,
						parentId: channel.parent_id ?? null,
					}),
				)
		})

		const createMessage = Effect.fn("DiscordApiClient.createMessage")(function* (params: {
			channelId: string
			content: string
			botToken: string
			replyToMessageId?: string
		}) {
			const payload: {
				content: string
				message_reference?: {
					message_id: string
				}
			} = {
				content: params.content,
			}

			if (params.replyToMessageId) {
				payload.message_reference = {
					message_id: params.replyToMessageId,
				}
			}

			const requestBody = HttpBody.text(JSON.stringify(payload), "application/json")
			const response = yield* makeBotClient(params.botToken)
				.post(`${DISCORD_API_BASE_URL}/channels/${params.channelId}/messages`, {
					body: requestBody,
					headers: {
						"Content-Type": "application/json",
					},
				})
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(DiscordMessageCreateResponse)),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord create message response",
							cause,
						}),
				),
			)

			return body.id
		})

		const createWebhook = Effect.fn("DiscordApiClient.createWebhook")(function* (params: {
			channelId: string
			botToken: string
		}) {
			const response = yield* makeBotClient(params.botToken)
				.post(`${DISCORD_API_BASE_URL}/channels/${params.channelId}/webhooks`, {
					body: HttpBody.text(
						JSON.stringify({
							name: "Hazel Sync",
						}),
						"application/json",
					),
					headers: {
						"Content-Type": "application/json",
					},
				})
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(DiscordWebhookCreateResponse)),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord create webhook response",
							cause,
						}),
				),
			)

			return {
				webhookId: body.id,
				webhookToken: body.token,
			}
		})

		const executeWebhookMessage = Effect.fn("DiscordApiClient.executeWebhookMessage")(function* (params: {
			webhookId: string
			webhookToken: string
			content: string
			replyToExternalMessageId?: string
			username?: string
			avatarUrl?: string
		}) {
			const payload: {
				content: string
				username?: string
				avatar_url?: string
				message_reference?: {
					message_id: string
				}
			} = {
				content: params.content,
			}
			if (params.username) {
				payload.username = params.username
			}
			if (params.avatarUrl) {
				payload.avatar_url = params.avatarUrl
			}
			if (params.replyToExternalMessageId) {
				payload.message_reference = {
					message_id: params.replyToExternalMessageId,
				}
			}

			const response = yield* httpClient
				.post(
					`${DISCORD_API_BASE_URL}/webhooks/${params.webhookId}/${params.webhookToken}?wait=true`,
					{
						body: HttpBody.text(JSON.stringify(payload), "application/json"),
						headers: {
							"Content-Type": "application/json",
						},
					},
				)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(DiscordMessageCreateResponse)),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord execute webhook message response",
							cause,
						}),
				),
			)

			return body.id
		})

		const updateWebhookMessage = Effect.fn("DiscordApiClient.updateWebhookMessage")(function* (params: {
			webhookId: string
			webhookToken: string
			webhookMessageId: string
			content: string
		}) {
			const response = yield* httpClient
				.patch(
					`${DISCORD_API_BASE_URL}/webhooks/${params.webhookId}/${params.webhookToken}/messages/${params.webhookMessageId}`,
					{
						body: HttpBody.text(JSON.stringify({ content: params.content }), "application/json"),
						headers: {
							"Content-Type": "application/json",
						},
					},
				)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}
		})

		const deleteWebhookMessage = Effect.fn("DiscordApiClient.deleteWebhookMessage")(function* (params: {
			webhookId: string
			webhookToken: string
			webhookMessageId: string
		}) {
			const response = yield* httpClient
				.del(
					`${DISCORD_API_BASE_URL}/webhooks/${params.webhookId}/${params.webhookToken}/messages/${params.webhookMessageId}`,
				)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}
		})

		const updateMessage = Effect.fn("DiscordApiClient.updateMessage")(function* (params: {
			channelId: string
			messageId: string
			content: string
			botToken: string
		}) {
			const requestBody = HttpBody.text(JSON.stringify({ content: params.content }), "application/json")
			const response = yield* makeBotClient(params.botToken)
				.patch(`${DISCORD_API_BASE_URL}/channels/${params.channelId}/messages/${params.messageId}`, {
					body: requestBody,
					headers: {
						"Content-Type": "application/json",
					},
				})
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}
		})

		const deleteMessage = Effect.fn("DiscordApiClient.deleteMessage")(function* (params: {
			channelId: string
			messageId: string
			botToken: string
		}) {
			const response = yield* makeBotClient(params.botToken)
				.del(`${DISCORD_API_BASE_URL}/channels/${params.channelId}/messages/${params.messageId}`)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}
		})

		const addReaction = Effect.fn("DiscordApiClient.addReaction")(function* (params: {
			channelId: string
			messageId: string
			emoji: string
			botToken: string
		}) {
			const encodedEmoji = encodeURIComponent(params.emoji)
			const response = yield* makeBotClient(params.botToken)
				.put(
					`${DISCORD_API_BASE_URL}/channels/${params.channelId}/messages/${params.messageId}/reactions/${encodedEmoji}/@me`,
				)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}
		})

		const removeReaction = Effect.fn("DiscordApiClient.removeReaction")(function* (params: {
			channelId: string
			messageId: string
			emoji: string
			botToken: string
		}) {
			const encodedEmoji = encodeURIComponent(params.emoji)
			const response = yield* makeBotClient(params.botToken)
				.del(
					`${DISCORD_API_BASE_URL}/channels/${params.channelId}/messages/${params.messageId}/reactions/${encodedEmoji}/@me`,
				)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}
		})

		const createThread = Effect.fn("DiscordApiClient.createThread")(function* (params: {
			channelId: string
			messageId: string
			name: string
			botToken: string
		}) {
			const requestBody = HttpBody.text(
				JSON.stringify({
					name: params.name,
					auto_archive_duration: 1440,
				}),
				"application/json",
			)
			const response = yield* makeBotClient(params.botToken)
				.post(
					`${DISCORD_API_BASE_URL}/channels/${params.channelId}/messages/${params.messageId}/threads`,
					{
						body: requestBody,
						headers: {
							"Content-Type": "application/json",
						},
					},
				)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				return yield* handleApiError(response)
			}

			const body = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(DiscordMessageCreateResponse)),
				Effect.mapError(
					(cause) =>
						new DiscordApiError({
							message: "Failed to parse Discord create thread response",
							cause,
						}),
				),
			)

			return body.id
		})

		return {
			getAccountInfo,
			listGuilds,
			listGuildChannels,
			createMessage,
			updateMessage,
			deleteMessage,
			createWebhook,
			executeWebhookMessage,
			updateWebhookMessage,
			deleteWebhookMessage,
			addReaction,
			removeReaction,
			createThread,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}
