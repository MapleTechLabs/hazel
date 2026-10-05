import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { UserPresenceStatusId } from "@hazel/schema"
import { UserPresenceStatus } from "../models"
import { JsonDate } from "../models/utils"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful user presence status operations.
 * Contains the status data and a transaction ID for optimistic updates.
 */
export class UserPresenceStatusResponse extends Schema.Class<UserPresenceStatusResponse>(
	"UserPresenceStatusResponse",
)({
	data: UserPresenceStatus.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a user presence status is not found.
 * Used in update operations.
 */
export class UserPresenceStatusNotFoundError extends Schema.TaggedError<UserPresenceStatusNotFoundError>()(
	"UserPresenceStatusNotFoundError",
	{
		statusId: UserPresenceStatusId,
	},
) {}

/**
 * UserPresenceStatus RPC Group
 *
 * Defines RPC methods for user presence status operations:
 * - UserPresenceStatusUpdate: Update user's presence status and custom message
 *
 * All methods require authentication via AuthMiddleware.
 *
 * Example usage from frontend:
 * ```typescript
 * const client = yield* RpcClient
 *
 * // Update presence status
 * const result = yield* client.UserPresenceStatusUpdate({
 *   status: "online",
 *   customMessage: "Working on something cool"
 * })
 * ```
 */
export class UserPresenceStatusRpcs extends RpcGroup.make(
	/**
	 * UserPresenceStatusUpdate
	 *
	 * Updates the user's presence status and optional custom message.
	 * The userId is automatically set from the authenticated user (CurrentUser).
	 *
	 * @param payload - Status and optional custom message
	 * @returns Updated status data and transaction ID
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("userPresenceStatus.update", {
		payload: Schema.Struct({
			status: Schema.optional(UserPresenceStatus.Schema.fields.status),
			customMessage: Schema.optional(Schema.NullOr(Schema.String)),
			statusEmoji: Schema.optional(Schema.NullOr(Schema.String)),
			statusExpiresAt: Schema.optional(Schema.NullOr(JsonDate)),
			activeChannelId: Schema.optional(Schema.NullOr(UserPresenceStatus.Schema.fields.activeChannelId)),
			suppressNotifications: Schema.optional(Schema.Boolean),
		}),
		success: UserPresenceStatusResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["user-presence-status:write"])
		.middleware(AuthMiddleware),

	/**
	 * UserPresenceStatusHeartbeat
	 *
	 * Lightweight heartbeat to update lastSeenAt timestamp.
	 * Used for reliable offline detection - if no heartbeat received
	 * within timeout period, user is marked offline by server-side cron job.
	 *
	 * @returns Updated lastSeenAt timestamp
	 * @throws UnauthorizedError if not authenticated
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("userPresenceStatus.heartbeat", {
		payload: Schema.Struct({}),
		success: Schema.Struct({
			lastSeenAt: JsonDate,
		}),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["user-presence-status:write"])
		.middleware(AuthMiddleware),

	/**
	 * UserPresenceStatusClearStatus
	 *
	 * Clears the user's custom status (emoji, message, and expiration).
	 * Does not affect the user's presence status (online/away/etc).
	 *
	 * @returns Updated status data and transaction ID
	 * @throws UnauthorizedError if not authenticated
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("userPresenceStatus.clearStatus", {
		payload: Schema.Struct({}),
		success: UserPresenceStatusResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["user-presence-status:write"])
		.middleware(AuthMiddleware),
) {}
