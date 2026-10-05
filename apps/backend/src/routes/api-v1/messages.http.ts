import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import {
	AttachmentRepo,
	BotRepo,
	MessageOutboxRepo,
	MessageReactionRepo,
	MessageRepo,
} from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, InternalServerError, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import { CurrentRpcScopes, type ApiScope } from "@hazel/domain/scopes"
import type { MessageId } from "@hazel/schema"
import {
	ChannelNotFoundError,
	DeleteMessageResponse,
	InvalidPaginationError,
	ListMessagesResponse,
	MessageResponse,
	ToggleReactionResponse,
} from "@hazel/domain/http"
import { Effect, Option } from "effect"
import { HazelApi } from "../../api"
import { generateTransactionId } from "../../lib/create-transactionId"
import { AttachmentPolicy } from "../../policies/attachment-policy"
import { MessagePolicy } from "../../policies/message-policy"
import { MessageReactionPolicy } from "../../policies/message-reaction-policy"
import { BotGatewayService } from "../../services/bot-gateway-service"
import { checkMessageRateLimit } from "../../services/rate-limit-helpers"

/**
 * Hash a token using SHA-256 (Web Crypto API)
 */
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Authenticate bot from Bearer token and return bot info
 */
const authenticateBotFromToken = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const authHeader = request.headers.authorization

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "Missing or invalid API token",
				detail: "Authorization header must be 'Bearer <token>'",
			}),
		)
	}

	const token = authHeader.slice(7)
	const tokenHash = yield* Effect.promise(() => hashToken(token))

	const botRepo = yield* BotRepo
	const botOption = yield* botRepo.findByTokenHash(tokenHash)

	if (Option.isNone(botOption)) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "Invalid API token",
				detail: "No bot found with this token",
			}),
		)
	}

	return botOption.value
})

/**
 * Create a CurrentUser context for the bot
 * Bots act as their associated user account
 */
const createBotUserContext = (bot: { userId: typeof import("@hazel/schema").UserId.Type; name: string }) =>
	new CurrentUser.Schema({
		id: bot.userId,
		role: "member",
		email: `bot-${bot.name}@hazel.bot`,
		isOnboarded: true,
		timezone: null,
		organizationId: null,
		settings: null,
	})

const withHttpScopes = <A, E, R>(
	scopes: ReadonlyArray<ApiScope>,
	make: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.provideService(make, CurrentRpcScopes, scopes) as Effect.Effect<A, E, R>

export const HttpMessagesApiLive = HttpApiBuilder.group(HazelApi, "api-v1-messages", (handlers) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const botGateway = yield* BotGatewayService
		const outboxRepo = yield* MessageOutboxRepo
		const messagePolicy = yield* MessagePolicy
		const messageRepo = yield* MessageRepo
		const messageReactionPolicy = yield* MessageReactionPolicy
		const messageReactionRepo = yield* MessageReactionRepo
		const attachmentPolicy = yield* AttachmentPolicy
		const attachmentRepo = yield* AttachmentRepo

		return (
			handlers
				// List Messages (with cursor-based pagination)
				.handle("listMessages", ({ query }) =>
					withHttpScopes(
						["messages:read"],
						Effect.gen(function* () {
							const bot = yield* authenticateBotFromToken
							const currentUser = createBotUserContext(bot)

							const { channel_id, starting_after, ending_before, limit } = query

							// Validate: cannot specify both cursors
							if (starting_after && ending_before) {
								return yield* Effect.fail(
									new InvalidPaginationError({
										message: "Cannot specify both starting_after and ending_before",
									}),
								)
							}

							const effectiveLimit = limit ?? 25

							// First, check if user can read this channel (policy authorization)
							yield* messagePolicy
								.canRead(channel_id)
								.pipe(Effect.provideService(CurrentUser.Context, currentUser))

							// Resolve cursor IDs to stable cursor tuples.
							let cursorBefore:
								| {
										id: MessageId
										createdAt: Date
								  }
								| undefined = undefined
							let cursorAfter:
								| {
										id: MessageId
										createdAt: Date
								  }
								| undefined = undefined

							if (starting_after) {
								const cursorMsg = yield* messageRepo.findByIdForCursor({
									id: starting_after,
									channelId: channel_id,
								})
								if (Option.isNone(cursorMsg)) {
									return yield* Effect.fail(
										new InvalidPaginationError({
											message: "Invalid starting_after cursor for channel",
										}),
									)
								}
								cursorBefore = {
									id: cursorMsg.value.id,
									createdAt: cursorMsg.value.createdAt,
								}
							} else if (ending_before) {
								const cursorMsg = yield* messageRepo.findByIdForCursor({
									id: ending_before,
									channelId: channel_id,
								})
								if (Option.isNone(cursorMsg)) {
									return yield* Effect.fail(
										new InvalidPaginationError({
											message: "Invalid ending_before cursor for channel",
										}),
									)
								}
								cursorAfter = {
									id: cursorMsg.value.id,
									createdAt: cursorMsg.value.createdAt,
								}
							}

							// Query messages (policy already checked, use system actor for db access)
							const messages = yield* messageRepo.listByChannel({
								channelId: channel_id,
								cursorBefore,
								cursorAfter,
								limit: effectiveLimit,
							})

							const hasMore = messages.length > effectiveLimit
							const data = hasMore ? messages.slice(0, effectiveLimit) : messages

							return new ListMessagesResponse({
								data,
								has_more: hasMore,
							})
						}).pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Database error while listing messages",
										detail: String(err),
									}),
								),
							),
						),
					),
				)

				// Create Message
				.handle("createMessage", ({ payload }) =>
					withHttpScopes(
						["messages:write"],
						Effect.gen(function* () {
							const bot = yield* authenticateBotFromToken
							const currentUser = createBotUserContext(bot)

							yield* checkMessageRateLimit(bot.userId)

							const { attachmentIds, embeds, replyToMessageId, threadChannelId, ...rest } =
								payload

							const response = yield* db
								.transaction(
									Effect.gen(function* () {
										yield* messagePolicy.canCreate(rest.channelId)
										const createdMessage = yield* messageRepo
											.insert({
												...rest,
												embeds: embeds ?? null,
												replyToMessageId: replyToMessageId ?? null,
												threadChannelId: threadChannelId ?? null,
												authorId: bot.userId,
												deletedAt: null,
											})
											.pipe(Effect.map((res) => res[0]!))

										// Link attachments if provided
										if (attachmentIds && attachmentIds.length > 0) {
											yield* Effect.forEach(attachmentIds, (attachmentId) =>
												Effect.gen(function* () {
													yield* attachmentPolicy.canUpdate(attachmentId)
													yield* attachmentRepo.update({
														id: attachmentId,
														messageId: createdMessage.id,
													})
												}),
											)
										}

										yield* outboxRepo.insert({
											eventType: "message_created",
											aggregateId: createdMessage.id,
											channelId: createdMessage.channelId,
											payload: {
												messageId: createdMessage.id,
												channelId: createdMessage.channelId,
												authorId: createdMessage.authorId,
												content: createdMessage.content,
												replyToMessageId: createdMessage.replyToMessageId,
											},
										})

										const txid = yield* generateTransactionId()

										return new MessageResponse({
											data: createdMessage,
											transactionId: txid,
										})
									}),
								)
								.pipe(
									withRemapDbErrors("Message", "create"),
									Effect.provideService(CurrentUser.Context, currentUser),
								)

							yield* botGateway.publishMessageEvent("message.create", response.data).pipe(
								Effect.catchTag("DurableStreamRequestError", (error) =>
									Effect.logWarning("Failed to publish API message.create to bot gateway", {
										error,
										messageId: response.data.id,
									}),
								),
							)

							return response
						}).pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Database error while creating message",
										detail: String(err),
									}),
								),
							),
						),
					),
				)

				// Update Message
				.handle("updateMessage", ({ params, payload }) =>
					withHttpScopes(
						["messages:write"],
						Effect.gen(function* () {
							const bot = yield* authenticateBotFromToken
							const currentUser = createBotUserContext(bot)

							yield* checkMessageRateLimit(bot.userId)

							const { embeds, ...rest } = payload

							const response = yield* db
								.transaction(
									Effect.gen(function* () {
										yield* messagePolicy.canUpdate(params.id)
										const updatedMessage = yield* messageRepo.update({
											id: params.id,
											...rest,
											...(embeds !== undefined ? { embeds } : {}),
										})

										yield* outboxRepo.insert({
											eventType: "message_updated",
											aggregateId: updatedMessage.id,
											channelId: updatedMessage.channelId,
											payload: {
												messageId: updatedMessage.id,
											},
										})

										const txid = yield* generateTransactionId()

										return new MessageResponse({
											data: updatedMessage,
											transactionId: txid,
										})
									}),
								)
								.pipe(
									withRemapDbErrors("Message", "update"),
									Effect.provideService(CurrentUser.Context, currentUser),
								)

							yield* botGateway.publishMessageEvent("message.update", response.data).pipe(
								Effect.catchTag("DurableStreamRequestError", (error) =>
									Effect.logWarning("Failed to publish API message.update to bot gateway", {
										error,
										messageId: response.data.id,
									}),
								),
							)

							return response
						}).pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Database error while updating message",
										detail: String(err),
									}),
								),
							),
						),
					),
				)

				// Delete Message
				.handle("deleteMessage", ({ params }) =>
					withHttpScopes(
						["messages:write"],
						Effect.gen(function* () {
							const bot = yield* authenticateBotFromToken
							const currentUser = createBotUserContext(bot)
							const existingMessage = yield* messageRepo.findById(params.id)

							yield* checkMessageRateLimit(bot.userId)

							const response = yield* db
								.transaction(
									Effect.gen(function* () {
										yield* messagePolicy.canDelete(params.id)
										yield* messageRepo.deleteById(params.id)

										if (Option.isSome(existingMessage)) {
											yield* outboxRepo.insert({
												eventType: "message_deleted",
												aggregateId: existingMessage.value.id,
												channelId: existingMessage.value.channelId,
												payload: {
													messageId: existingMessage.value.id,
													channelId: existingMessage.value.channelId,
												},
											})
										}

										const txid = yield* generateTransactionId()

										return new DeleteMessageResponse({ transactionId: txid })
									}),
								)
								.pipe(
									withRemapDbErrors("Message", "delete"),
									Effect.provideService(CurrentUser.Context, currentUser),
								)

							if (Option.isSome(existingMessage)) {
								yield* botGateway
									.publishMessageEvent("message.delete", existingMessage.value)
									.pipe(
										Effect.catchTag("DurableStreamRequestError", (error) =>
											Effect.logWarning(
												"Failed to publish API message.delete to bot gateway",
												{
													error,
													messageId: existingMessage.value.id,
												},
											),
										),
									)
							}

							return response
						}).pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Database error while deleting message",
										detail: String(err),
									}),
								),
							),
						),
					),
				)

				// Toggle Reaction
				.handle("toggleReaction", ({ params, payload }) =>
					withHttpScopes(
						["message-reactions:write"],
						Effect.gen(function* () {
							const bot = yield* authenticateBotFromToken
							const currentUser = createBotUserContext(bot)

							const result = yield* db
								.transaction(
									Effect.gen(function* () {
										const { emoji, channelId } = payload
										const messageId = params.id

										yield* messageReactionPolicy.canList(messageId)
										const existingReaction =
											yield* messageReactionRepo.findByMessageUserEmoji(
												messageId,
												bot.userId,
												emoji,
											)

										const txid = yield* generateTransactionId()

										// If reaction exists, delete it
										if (Option.isSome(existingReaction)) {
											const deletedSyncPayload = {
												reactionId: existingReaction.value.id,
												hazelChannelId: existingReaction.value.channelId,
												hazelMessageId: existingReaction.value.messageId,
												emoji: existingReaction.value.emoji,
												userId: existingReaction.value.userId,
											} as const

											yield* messageReactionPolicy.canDelete(existingReaction.value.id)
											yield* messageReactionRepo.deleteById(existingReaction.value.id)
											yield* outboxRepo.insert({
												eventType: "reaction_deleted",
												aggregateId: existingReaction.value.id,
												channelId: existingReaction.value.channelId,
												payload: {
													hazelChannelId: existingReaction.value.channelId,
													hazelMessageId: existingReaction.value.messageId,
													emoji: existingReaction.value.emoji,
													userId: existingReaction.value.userId,
												},
											})

											return {
												wasCreated: false,
												data: undefined,
												transactionId: txid,
												deletedSyncPayload,
											}
										}

										// Otherwise, create a new reaction
										yield* messageReactionPolicy.canCreate(messageId)
										const createdReaction = yield* messageReactionRepo
											.insert({
												messageId,
												channelId,
												emoji,
												userId: bot.userId,
											})
											.pipe(Effect.map((res) => res[0]!))

										yield* outboxRepo.insert({
											eventType: "reaction_created",
											aggregateId: createdReaction.id,
											channelId: createdReaction.channelId,
											payload: {
												reactionId: createdReaction.id,
											},
										})

										return {
											wasCreated: true,
											data: createdReaction,
											transactionId: txid,
											deletedSyncPayload: null,
										}
									}),
								)
								.pipe(
									withRemapDbErrors("MessageReaction", "create"),
									Effect.provideService(CurrentUser.Context, currentUser),
								)

							return new ToggleReactionResponse({
								wasCreated: result.wasCreated,
								data: result.data,
								transactionId: result.transactionId,
							})
						}).pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Database error while toggling reaction",
										detail: String(err),
									}),
								),
							),
						),
					),
				)
		)
	}),
)
