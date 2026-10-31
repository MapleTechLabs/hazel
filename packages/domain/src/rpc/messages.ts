import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, MessageNotFoundError, UnauthorizedError } from "../errors"
import { ChannelId, HtmlRenderId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Message } from "../models"
import { RateLimitExceededError } from "../rate-limit-errors"
import { TransactionId } from "@hazel/schema"
import { RequiredScopes } from "../scopes/required-scopes"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"
import { RouteChannelId } from "./routing-fields"

// Re-export for backwards compatibility
export { MessageNotFoundError } from "../errors"

/**
 * Response schema for successful message operations.
 * Contains the message data and a transaction ID for optimistic updates.
 */
export class MessageResponse extends Schema.Class<MessageResponse>("MessageResponse")({
	data: Message.Schema,
	transactionId: TransactionId,
}) {}

export class HtmlRenderUrlResponse extends Schema.Class<HtmlRenderUrlResponse>("HtmlRenderUrlResponse")({
	url: Schema.String,
	/** Epoch milliseconds. */
	expiresAt: Schema.Number,
}) {}

/** `message.search`: the org's messages the caller can read, newest first. */
export const MessageSearchPayload = Schema.Struct({
	organizationId: OrganizationId,
	/** Words to match (prefix match, all must appear); empty searches by the filters alone. */
	query: Schema.String.check(Schema.isMaxLength(500)),
	channelId: Schema.optional(ChannelId),
	authorId: Schema.optional(UserId),
	/** Only messages created before / after this instant. */
	before: Schema.optional(Schema.Date),
	after: Schema.optional(Schema.Date),
	limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
	/** `nextCursor` of the previous page. */
	cursor: Schema.optional(Schema.String),
})
export type MessageSearchPayload = typeof MessageSearchPayload.Type

/** A matched range in `snippet`, `[start, end)` in UTF-16 code units. */
export const MessageSearchHighlight = Schema.Struct({ start: Schema.Number, end: Schema.Number })

export const MessageSearchHit = Schema.Struct({
	messageId: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	createdAt: Schema.Date,
	/** The message as plain text, cut around the match. */
	snippet: Schema.String,
	highlights: Schema.Array(MessageSearchHighlight),
})
export type MessageSearchHit = typeof MessageSearchHit.Type

export class MessageSearchResponse extends Schema.Class<MessageSearchResponse>("MessageSearchResponse")({
	results: Schema.Array(MessageSearchHit),
	nextCursor: Schema.NullOr(Schema.String),
	/** The org's index is still being built from existing messages: results may be incomplete. */
	indexing: Schema.Boolean,
	/** Search is down for this org (its index could not be created): no results, try later. */
	unavailable: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * Message RPC Group
 *
 * Defines all RPC methods for message operations:
 * - MessageCreate: Create a new message in a channel
 * - MessageUpdate: Update an existing message
 * - MessageDelete: Delete a message
 *
 * All methods require authentication via AuthMiddleware.
 * Rate limiting (60 req/min per user) is applied in the handlers.
 *
 * Example usage from frontend:
 * ```typescript
 * const client = yield* RpcClient
 *
 * // Create message
 * const result = yield* client.MessageCreate({
 *   channelId: "...",
 *   content: "Hello world",
 *   attachmentIds: []
 * })
 *
 * // Update message
 * yield* client.MessageUpdate({
 *   id: "...",
 *   content: "Updated content"
 * })
 *
 * // Delete message
 * yield* client.MessageDelete({ id: "..." })
 * ```
 */
export class MessageRpcs extends RpcGroup.make(
	/**
	 * MessageCreate
	 *
	 * Creates a new message in a channel.
	 * The authorId is automatically set from the authenticated user (CurrentUser).
	 * If attachmentIds are provided, those attachments are linked to the message.
	 *
	 * @param payload - Message data (channelId, content, etc.) + optional attachmentIds
	 * @returns Message data and transaction ID
	 * @throws ChannelNotFoundError if channel doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws RateLimitExceededError if rate limit exceeded (60/min)
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("message.create", {
		payload: Message.Insert,
		success: MessageResponse,
		error: Schema.Union([
			ChannelNotFoundError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["messages:write"])
		.middleware(AuthMiddleware),

	/**
	 * MessageUpdate
	 *
	 * Updates an existing message.
	 * Only the message author or users with appropriate permissions can update.
	 *
	 * @param payload - Message ID and optional fields to update
	 * @returns Updated message data and transaction ID
	 * @throws MessageNotFoundError if message doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws RateLimitExceededError if rate limit exceeded (60/min)
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("message.update", {
		payload: Schema.Struct({
			channelId: RouteChannelId,
			id: MessageId,
		}).pipe(Schema.fieldsAssign(Message.Patch.fields)),
		success: MessageResponse,
		error: Schema.Union([
			MessageNotFoundError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["messages:write"])
		.middleware(AuthMiddleware),

	/**
	 * MessageDelete
	 *
	 * Deletes a message (soft delete).
	 * Only the message author or users with appropriate permissions can delete.
	 *
	 * @param payload - Message ID to delete
	 * @returns Transaction ID
	 * @throws MessageNotFoundError if message doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws RateLimitExceededError if rate limit exceeded (60/min)
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("message.delete", {
		payload: Schema.Struct({ id: MessageId, channelId: RouteChannelId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			MessageNotFoundError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["messages:write"])
		.middleware(AuthMiddleware),

	/**
	 * MessageHtmlRenderUrl
	 *
	 * A short-lived signed URL for an HTML render a message shows (`MessageEmbed.html`), for a
	 * viewer of its channel. The page is served sandboxed (`@hazel/domain/html-render`).
	 *
	 * @throws MessageNotFoundError if the message is gone or does not show the render
	 */
	Rpc.make("message.htmlRenderUrl", {
		payload: Schema.Struct({ channelId: ChannelId, messageId: MessageId, renderId: HtmlRenderId }),
		success: HtmlRenderUrlResponse,
		error: Schema.Union([MessageNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["messages:read"])
		.middleware(AuthMiddleware),

	/**
	 * MessageSearch
	 *
	 * Full-text search over the organization's messages (its `OrgObject`'s index), limited to the
	 * channels the caller can read.
	 */
	Rpc.make("message.search", {
		payload: MessageSearchPayload,
		success: MessageSearchResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["messages:read"])
		.middleware(AuthMiddleware),
) {}
