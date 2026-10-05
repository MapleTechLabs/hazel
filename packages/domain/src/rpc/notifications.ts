import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChannelId, MessageId, NotificationId } from "@hazel/schema"
import { Notification } from "../models"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful notification operations.
 * Contains the notification data and a transaction ID for optimistic updates.
 */
export class NotificationResponse extends Schema.Class<NotificationResponse>("NotificationResponse")({
	data: Notification.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a notification is not found.
 * Used in update and delete operations.
 */
export class NotificationNotFoundError extends Schema.TaggedError<NotificationNotFoundError>()(
	"NotificationNotFoundError",
	{
		notificationId: NotificationId,
	},
) {}

export class NotificationRpcs extends RpcGroup.make(
	/**
	 * NotificationCreate
	 *
	 * Creates a new notification for a member.
	 * Notifications can be used for mentions, reactions, system alerts, etc.
	 *
	 * @param payload - Notification data (memberId, type, content, etc.)
	 * @returns Notification data and transaction ID
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("notification.create", {
		payload: Notification.Create,
		success: NotificationResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["notifications:write"])
		.middleware(AuthMiddleware),

	/**
	 * NotificationUpdate
	 *
	 * Updates an existing notification.
	 * Typically used to mark notifications as read.
	 *
	 * @param payload - Notification ID and fields to update
	 * @returns Updated notification data and transaction ID
	 * @throws NotificationNotFoundError if notification doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("notification.update", {
		payload: Schema.Struct({
			id: NotificationId,
		}).pipe(Schema.fieldsAssign(Notification.PatchPartial.fields)),
		success: NotificationResponse,
		error: Schema.Union([NotificationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["notifications:write"])
		.middleware(AuthMiddleware),

	/**
	 * NotificationDelete
	 *
	 * Deletes a notification.
	 * Only the notification owner or users with appropriate permissions can delete.
	 *
	 * @param payload - Notification ID to delete
	 * @returns Transaction ID
	 * @throws NotificationNotFoundError if notification doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("notification.delete", {
		payload: Schema.Struct({ id: NotificationId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([NotificationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["notifications:write"])
		.middleware(AuthMiddleware),

	/**
	 * NotificationDeleteByMessageIds
	 *
	 * Bulk deletes notifications for the current user by message IDs.
	 * Used when messages become visible in the viewport to clear their notifications.
	 *
	 * @param payload - Array of message IDs and channel ID for context
	 * @returns Number of deleted notifications and transaction ID
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("notification.deleteByMessageIds", {
		payload: Schema.Struct({
			messageIds: Schema.Array(MessageId),
			channelId: ChannelId,
		}),
		success: Schema.Struct({
			deletedCount: Schema.Number,
			transactionId: TransactionId,
		}),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["notifications:write"])
		.middleware(AuthMiddleware),
) {}
