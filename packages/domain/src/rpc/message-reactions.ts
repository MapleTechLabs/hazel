import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { MessageReactionId } from "@hazel/schema"
import { MessageReaction } from "../models"
import { TransactionId } from "@hazel/schema"
import { MessageNotFoundError } from "./messages"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful message reaction operations.
 * Contains the message reaction data and a transaction ID for optimistic updates.
 */
export class MessageReactionResponse extends Schema.Class<MessageReactionResponse>("MessageReactionResponse")(
	{
		data: MessageReaction.Schema,
		transactionId: TransactionId,
	},
) {}

/**
 * Error thrown when a message reaction is not found.
 * Used in update and delete operations.
 */
export class MessageReactionNotFoundError extends Schema.TaggedError<MessageReactionNotFoundError>()(
	"MessageReactionNotFoundError",
	{
		messageReactionId: MessageReactionId,
	},
) {}

export class MessageReactionRpcs extends RpcGroup.make(
	/**
	 * MessageReactionToggle
	 *
	 * Toggles a reaction on a message. If the user has already reacted with this emoji,
	 * the reaction will be removed. If not, a new reaction will be created.
	 * The userId is automatically set from the authenticated user (CurrentUser).
	 *
	 * @param payload - Message reaction data (messageId, emoji)
	 * @returns Object with wasCreated boolean, optional data, and transaction ID
	 * @throws MessageNotFoundError if message doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("messageReaction.toggle", {
		payload: Schema.Struct({
			messageId: MessageReaction.Insert.fields.messageId,
			channelId: MessageReaction.Insert.fields.channelId,
			emoji: MessageReaction.Insert.fields.emoji,
		}),
		success: Schema.Struct({
			wasCreated: Schema.Boolean,
			data: Schema.optional(MessageReaction.Schema),
			transactionId: TransactionId,
		}),
		error: Schema.Union([MessageNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["message-reactions:write"])
		.middleware(AuthMiddleware),

	/**
	 * MessageReactionCreate
	 *
	 * Creates a new reaction on a message.
	 * The userId is automatically set from the authenticated user (CurrentUser).
	 *
	 * @param payload - Message reaction data (messageId, emoji)
	 * @returns Message reaction data and transaction ID
	 * @throws MessageNotFoundError if message doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("messageReaction.create", {
		payload: MessageReaction.Insert,
		success: MessageReactionResponse,
		error: Schema.Union([MessageNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["message-reactions:write"])
		.middleware(AuthMiddleware),

	/**
	 * MessageReactionUpdate
	 *
	 * Updates an existing message reaction.
	 * Only the reaction creator or users with appropriate permissions can update.
	 *
	 * @param payload - Message reaction ID and fields to update
	 * @returns Updated message reaction data and transaction ID
	 * @throws MessageReactionNotFoundError if reaction doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("messageReaction.update", {
		payload: Schema.Struct({
			id: MessageReactionId,
		}).pipe(Schema.fieldsAssign(MessageReaction.PatchPartial.fields)),
		success: MessageReactionResponse,
		error: Schema.Union([MessageReactionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["message-reactions:write"])
		.middleware(AuthMiddleware),

	/**
	 * MessageReactionDelete
	 *
	 * Deletes a message reaction.
	 * Only the reaction creator or users with appropriate permissions can delete.
	 *
	 * @param payload - Message reaction ID to delete
	 * @returns Transaction ID
	 * @throws MessageReactionNotFoundError if reaction doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("messageReaction.delete", {
		payload: Schema.Struct({ id: MessageReactionId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([MessageReactionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["message-reactions:write"])
		.middleware(AuthMiddleware),
) {}
