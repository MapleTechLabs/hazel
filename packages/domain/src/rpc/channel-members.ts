import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChannelId, ChannelMemberId, OrganizationId } from "@hazel/schema"
import { ChannelMember, JsonDate, NotificationOverride } from "../models"
import { TransactionId } from "@hazel/schema"
import { ChannelNotFoundError } from "./channels"
import { ChannelSectionNotFoundError } from "./channel-sections"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"
import { RouteOrganizationId } from "./routing-fields"

/**
 * Response schema for successful channel member operations.
 * Contains the channel member data and a transaction ID for optimistic updates.
 */
export class ChannelMemberResponse extends Schema.Class<
	ChannelMemberResponse,
	{ readonly brand: unique symbol }
>("ChannelMemberResponse")({
	data: ChannelMember.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a channel member is not found.
 * Used in update and delete operations.
 */
export class ChannelMemberNotFoundError extends Schema.TaggedError<
	ChannelMemberNotFoundError,
	{ readonly brand: unique symbol }
>()("ChannelMemberNotFoundError", {
	channelMemberId: ChannelMemberId,
}) {}

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
			organizationId: RouteOrganizationId,
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
		payload: Schema.Struct({ id: ChannelMemberId, organizationId: RouteOrganizationId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ChannelMemberNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelMemberClearNotifications
	 *
	 * Marks the channel read for the current user: moves their read position (`channel_read_state`)
	 * to now, resets their notification count and drops their notifications in it. Called when a user views a channel and on
	 * Escape.
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

	/**
	 * ChannelMemberMarkAllRead
	 *
	 * Marks every channel the current user is in, in the organization, read (Shift+Escape): what
	 * `channelMember.clearNotifications` does for one channel, for all of them.
	 */
	/**
	 * ChannelMemberSetScopeNotifications
	 *
	 * The current user's notification settings for the organization or one of its sections
	 * (Discord's server and category settings). Fields left out keep their value; a scope with no
	 * row yet starts at the defaults.
	 */
	Rpc.make("channelMember.setScopeNotifications", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			scope: NotificationOverride.Scope,
			/** The organization's id, or the section's. */
			scopeId: Schema.String,
			level: Schema.optional(Schema.NullOr(ChannelMember.NotificationLevel)),
			isMuted: Schema.optional(Schema.Boolean),
			mutedUntil: Schema.optional(Schema.NullOr(JsonDate)),
			suppressEveryone: Schema.optional(Schema.Boolean),
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ChannelSectionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	/** The current user's settings for the scope back to the defaults (the row goes). */
	Rpc.make("channelMember.resetScopeNotifications", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			scope: NotificationOverride.Scope,
			scopeId: Schema.String,
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),

	Rpc.make("channelMember.markAllRead", {
		payload: Schema.Struct({ organizationId: OrganizationId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-members:write"])
		.middleware(AuthMiddleware),
) {}
