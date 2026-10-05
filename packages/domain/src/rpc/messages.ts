import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, MessageNotFoundError, UnauthorizedError } from "../errors"
import { MessageId } from "@hazel/schema"
import { Message } from "../models"
import { RateLimitExceededError } from "../rate-limit-errors"
import { TransactionId } from "@hazel/schema"
import { RequiredScopes } from "../scopes/required-scopes"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"

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
		payload: Schema.Struct({ id: MessageId }),
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
) {}
