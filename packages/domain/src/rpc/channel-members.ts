import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChannelId, ChannelMemberId } from "@hazel/schema"
import { ChannelMember } from "../models"
import { TransactionId } from "@hazel/schema"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful channel member operations.
 * Contains the channel member data and a transaction ID for optimistic updates.
 */
export class ChannelMemberResponse extends Schema.Class<ChannelMemberResponse>("ChannelMemberResponse")({
	data: ChannelMember.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a channel member is not found.
 * Used in update and delete operations.
 */
export class ChannelMemberNotFoundError extends Schema.TaggedError<ChannelMemberNotFoundError>()(
	"ChannelMemberNotFoundError",
	{
		channelMemberId: ChannelMemberId,
	},
) {}

/**
 * Channel Member RPC Group
 *
 * Defines all RPC methods for channel member operations:
 * - ChannelMemberCreate: Add a user to a channel
 * - ChannelMemberUpdate: Update channel member preferences
 * - ChannelMemberDelete: Remove a user from a channel
 *
 * All methods require authentication via AuthMiddleware.
 *
 * Example usage from frontend:
 * ```typescript
 * const client = yield* RpcClient
 *
 * // Add member to channel
 * const result = yield* client.ChannelMemberCreate({
 *   channelId: "...",
 *   isHidden: false,
 *   isMuted: false,
 *   isFavorite: false,
 *   lastSeenMessageId: null
 * })
 *
 * // Update member preferences
 * yield* client.ChannelMemberUpdate({
 *   id: "...",
 *   isMuted: true,
 *   isFavorite: true
 * })
 *
 * // Remove member from channel
 * yield* client.ChannelMemberDelete({ id: "..." })
 * ```
 */
export class ChannelMemberRpcs extends RpcGroup.make(
	/**
	 * ChannelMemberCreate
	 *
	 * Adds the current user to a channel.
	 * The userId is automatically set from the authenticated user (CurrentUser).
	 * Requires permission to join the channel (e.g., public channels or organization admin).
	 *
	 * @param payload - channelId (other fields use defaults)
	 * @returns Channel member data and transaction ID
	 * @throws ChannelNotFoundError if channel doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelMember.create", {
		payload: Schema.Struct({
			channelId: ChannelId,
		}),
		success: ChannelMemberResponse,
		error: Schema.Union([ChannelNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelMemberUpdate
	 *
	 * Updates channel member preferences and settings.
	 * Members can update their own preferences (mute, hide, favorite).
	 * Organization admins can update any member's settings.
	 *
	 * @param payload - Channel member ID and optional fields to update
	 * @returns Updated channel member data and transaction ID
	 * @throws ChannelMemberNotFoundError if channel member doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelMember.update", {
		payload: Schema.Struct({
			id: ChannelMemberId,
		}).pipe(Schema.fieldsAssign(ChannelMember.PatchPartial.fields)),
		success: ChannelMemberResponse,
		error: Schema.Union([ChannelMemberNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelMemberDelete
	 *
	 * Removes a user from a channel (soft delete).
	 * Members can leave channels themselves.
	 * Organization admins can remove any member from a channel.
	 *
	 * @param payload - Channel member ID to delete
	 * @returns Transaction ID
	 * @throws ChannelMemberNotFoundError if channel member doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelMember.delete", {
		payload: Schema.Struct({ id: ChannelMemberId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ChannelMemberNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelMemberClearNotifications
	 *
	 * Clears the notification count for the current user in a specific channel.
	 * Called when a user views/enters a channel to reset their unread notification count.
	 *
	 * @param payload - Channel ID to clear notifications for
	 * @returns Transaction ID
	 * @throws ChannelNotFoundError if channel doesn't exist
	 * @throws UnauthorizedError if user is not a member
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelMember.clearNotifications", {
		payload: Schema.Struct({ channelId: ChannelId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ChannelNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),
) {}
