/**
 * The public bot API's messages and reactions. The bot authenticates with its token (directory
 * `bots`); writes run as the bot's user through the same HazelRpc methods the app uses
 * (`message.*`, `messageReaction.toggle`) in the channel's `ChannelObject`, so they get the same
 * policies and side effects. Listing is a typed call on that object (`channel.listMessages`).
 * Update and delete name the channel (`channelId`, `channel_id`): a message id alone cannot be
 * routed.
 */
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { BotRepo } from "@hazel/backend-core"
import { CurrentUser, InternalServerError, MessageNotFoundError, UnauthorizedError } from "@hazel/domain"
import {
	ChannelNotFoundError,
	DeleteMessageResponse,
	InvalidPaginationError,
	ListMessagesResponse,
	LiveStateResponse,
	MessageResponse,
	PublishHtmlRenderResponse,
	ToggleReactionResponse,
	WriteLiveStateResponse,
} from "@hazel/domain/http"
import type { MessageResponse as RpcMessageResponse } from "@hazel/domain/rpc"
import type { MessageReaction } from "@hazel/domain/models"
import type { ChannelId, MessageId, TransactionId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { HazelApi } from "../../api"
import { Directory } from "../../services/directory"
import { HtmlRenders } from "../../services/html-renders"
import { checkMessageRateLimit } from "../../services/rate-limit-helpers"
import { callObject } from "../../worker/objects/calls"
import { ListMessagesCall } from "../../worker/objects/channel/api-messages"
import { readLive, writeLive } from "../../worker/live/client"
import { forwardRpc } from "../../worker/objects/forward"
import { channelTarget } from "../../worker/objects/kinds"
import { providePrincipal } from "../../worker/objects/principal"

/** Hash a token using SHA-256 (Web Crypto API). */
async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

/** Authenticate the bot from its Bearer token. */
const authenticateBotFromToken = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const authHeader = request.headers.authorization
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return yield* new UnauthorizedError({
			message: "Missing or invalid API token",
			detail: "Authorization header must be 'Bearer <token>'",
		})
	}
	const tokenHash = yield* Effect.promise(() => hashToken(authHeader.slice(7)))
	const bot = yield* (yield* BotRepo).findByTokenHash(tokenHash)
	if (Option.isNone(bot)) {
		return yield* new UnauthorizedError({
			message: "Invalid API token",
			detail: "No bot found with this token",
		})
	}
	return bot.value
})

/** Bots act as their user, with a member's scopes (as the API always did). */
const botPrincipal = (bot: { readonly userId: UserId; readonly name: string }) => ({
	user: new CurrentUser.Schema({
		id: bot.userId,
		role: "member",
		email: `bot-${bot.name}@hazel.bot`,
		isOnboarded: true,
		timezone: null,
		organizationId: null,
		settings: null,
	}),
	botScopes: null,
})

/** The `ChannelObject` holding `channelId`'s messages (a Connect mount's host). */
const hostOf = (channelId: ChannelId) =>
	Effect.gen(function* () {
		const index = yield* (yield* Directory).channel(channelId)
		return channelTarget(
			Option.match(index, { onNone: () => channelId, onSome: (row) => row.hostChannelId ?? channelId }),
		)
	})

const internal = (message: string) => (cause: unknown) =>
	Effect.logError(message, { cause }).pipe(
		Effect.andThen(Effect.fail(new InternalServerError({ message, cause }))),
	)

const missingChannel = (messageId: MessageId) =>
	Effect.logWarning("API message write without its channel id", { messageId }).pipe(
		Effect.andThen(Effect.fail(new MessageNotFoundError({ messageId }))),
	)

const toHttpMessage = (response: RpcMessageResponse) =>
	new MessageResponse({ data: response.data, transactionId: response.transactionId })

export const HttpMessagesApiLive = HttpApiBuilder.group(HazelApi, "api-v1-messages", (handlers) =>
	Effect.succeed(
		handlers
			.handle("listMessages", ({ query }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					const { channel_id, starting_after, ending_before, limit } = query
					if (starting_after && ending_before) {
						return yield* new InvalidPaginationError({
							message: "Cannot specify both starting_after and ending_before",
						})
					}
					const page = yield* callObject(ListMessagesCall, yield* hostOf(channel_id), {
						userId: bot.userId,
						channelId: channel_id,
						startingAfter: starting_after ?? null,
						endingBefore: ending_before ?? null,
						limit: limit ?? 25,
					})
					return new ListMessagesResponse({ data: page.messages, has_more: page.hasMore })
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while listing messages"),
						ObjectCallError: internal("The channel is unavailable"),
					}),
					Effect.withSpan("ApiV1.listMessages"),
				),
			)
			.handle("createMessage", ({ payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					yield* checkMessageRateLimit(bot.userId)
					const { attachmentIds, embeds, replyToMessageId, threadChannelId, ...rest } = payload
					const response = yield* forwardRpc<RpcMessageResponse, ChannelNotFoundError>(
						yield* hostOf(payload.channelId),
						"message.create",
						{
							...rest,
							// Message.Insert's own fields; the handler authors it as the caller.
							authorId: bot.userId,
							deletedAt: null,
							embeds: embeds ?? null,
							replyToMessageId: replyToMessageId ?? null,
							threadChannelId: threadChannelId ?? null,
							...(attachmentIds === undefined ? {} : { attachmentIds }),
						},
					).pipe(providePrincipal(botPrincipal(bot)))
					return toHttpMessage(response)
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while creating message"),
						ChannelNotFoundError: (error: { readonly channelId: ChannelId }) =>
							Effect.fail(new ChannelNotFoundError({ channelId: error.channelId })),
					}),
					Effect.withSpan("ApiV1.createMessage"),
				),
			)
			.handle("updateMessage", ({ params, payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					yield* checkMessageRateLimit(bot.userId)
					const { channelId, embeds, ...rest } = payload
					if (channelId === undefined) return yield* missingChannel(params.id)
					const response = yield* forwardRpc<RpcMessageResponse, MessageNotFoundError>(
						yield* hostOf(channelId),
						"message.update",
						{ id: params.id, channelId, ...rest, ...(embeds !== undefined ? { embeds } : {}) },
					).pipe(providePrincipal(botPrincipal(bot)))
					return toHttpMessage(response)
				}).pipe(
					Effect.catchTag("DatabaseError", internal("Database error while updating message")),
					Effect.withSpan("ApiV1.updateMessage"),
				),
			)
			.handle("deleteMessage", ({ params, query }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					yield* checkMessageRateLimit(bot.userId)
					const channelId = query.channel_id
					if (channelId === undefined) return yield* missingChannel(params.id)
					const response = yield* forwardRpc<
						{ readonly transactionId: TransactionId },
						MessageNotFoundError
					>(yield* hostOf(channelId), "message.delete", { id: params.id, channelId }).pipe(
						providePrincipal(botPrincipal(bot)),
					)
					return new DeleteMessageResponse({ transactionId: response.transactionId })
				}).pipe(
					Effect.catchTag("DatabaseError", internal("Database error while deleting message")),
					Effect.withSpan("ApiV1.deleteMessage"),
				),
			)
			.handle("writeLiveState", ({ params, payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					const host = yield* hostOf(payload.channelId)
					const result = yield* writeLive({
						messageId: params.id,
						channelId: host.id as ChannelId,
						principal: botPrincipal(bot),
						action: payload.action,
					})
					return new WriteLiveStateResponse({ data: result })
				}).pipe(
					Effect.catchTag("DatabaseError", internal("Database error while writing live state")),
					Effect.withSpan("ApiV1.writeLiveState", {
						attributes: { "message.id": params.id, "live.action": payload.action._tag },
					}),
				),
			)
			.handle("getLiveState", ({ params, query }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					const host = yield* hostOf(query.channel_id)
					const state = yield* readLive({
						messageId: params.id,
						channelId: host.id as ChannelId,
						userId: bot.userId,
					})
					return new LiveStateResponse({ data: state })
				}).pipe(
					Effect.catchTag("DatabaseError", internal("Database error while reading live state")),
					Effect.withSpan("ApiV1.getLiveState", { attributes: { "message.id": params.id } }),
				),
			)
			// Stored under the named channel and the bot: only a message the bot posts there (which it
			// must be allowed to) shows it, and only that channel's viewers get a URL for it.
			.handle("publishHtmlRender", ({ payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					yield* checkMessageRateLimit(bot.userId)
					const data = yield* (yield* HtmlRenders).publish({ ...payload, authorId: bot.userId })
					return new PublishHtmlRenderResponse({ data })
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while publishing an HTML render"),
						HtmlRenderStoreError: internal("Could not store the HTML render"),
					}),
					Effect.withSpan("ApiV1.publishHtmlRender", {
						attributes: { "channel.id": payload.channelId },
					}),
				),
			)
			// Only the bot's own pages: the key carries its user id (`htmlRenderKey`).
			.handle("deleteHtmlRender", ({ params, query }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					yield* checkMessageRateLimit(bot.userId)
					yield* (yield* HtmlRenders).remove({
						channelId: query.channel_id,
						authorId: bot.userId,
						renderId: params.renderId,
					})
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while deleting an HTML render"),
						HtmlRenderStoreError: internal("Could not delete the HTML render"),
					}),
					Effect.withSpan("ApiV1.deleteHtmlRender", {
						attributes: { "html_render.id": params.renderId },
					}),
				),
			)
			.handle("toggleReaction", ({ params, payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					const result = yield* forwardRpc<
						{
							readonly wasCreated: boolean
							readonly data?: MessageReaction.Type | undefined
							readonly transactionId: TransactionId
						},
						MessageNotFoundError
					>(yield* hostOf(payload.channelId), "messageReaction.toggle", {
						messageId: params.id,
						channelId: payload.channelId,
						emoji: payload.emoji,
					}).pipe(providePrincipal(botPrincipal(bot)))
					return new ToggleReactionResponse({
						wasCreated: result.wasCreated,
						data: result.data,
						transactionId: result.transactionId,
					})
				}).pipe(
					Effect.catchTag("DatabaseError", internal("Database error while toggling reaction")),
					Effect.withSpan("ApiV1.toggleReaction"),
				),
			),
	),
)
