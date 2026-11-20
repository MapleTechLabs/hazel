/**
 * `user.createNotification`: a message notification for the `UserObject`'s owner, from the
 * channel's `OrgObject` (`../org/message-notifications.ts`). `memberId` is the owner's
 * `organization_members` id in that org, as the client's notifications collection expects.
 * `push` is what the owner's phones show, if it is pushed (`./push.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, MessageId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { NotificationReasons } from "../../../services/notifications/notification-rules"
import { defineEffect, enqueueEffect } from "../effects/registry"
import { NotificationCountOrgEffects } from "../org/notification-count"
import { isReading } from "./presence-model"
import { ownPresence } from "./presence-own"
import { PushContent, schedulePush } from "./push"

export const CreateNotificationPayload = Schema.Struct({
	memberId: OrganizationMemberId,
	channelId: ChannelId,
	messageId: MessageId,
	/** Optional: deliveries enqueued before reasons have none. */
	reason: Schema.optional(Schema.Literals(NotificationReasons)),
	silent: Schema.optional(Schema.Boolean),
	/** Optional: deliveries enqueued before push have none, and are not pushed. */
	push: Schema.optional(PushContent),
	/**
	 * The channel's org and this object's owner, so a notification dropped here (the owner is
	 * reading the channel) comes off the org's unread count. Optional: older deliveries lack them.
	 */
	organizationId: Schema.optional(OrganizationId),
	userId: Schema.optional(UserId),
})
export type CreateNotificationPayload = typeof CreateNotificationPayload.Type

/** Messages deleted: their notifications go, so a deferred or retrying push finds nothing to send. */
export const DeleteMessageNotificationsPayload = Schema.Struct({
	messageIds: Schema.Array(MessageId).check(Schema.isMaxLength(90)),
	/** The channel's org, told how many came off its unread count. */
	organizationId: OrganizationId,
	channelId: ChannelId,
	/** This object's owner (the org's guard holds the reply to it). */
	userId: UserId,
})

export const MessageNotificationEffects = {
	createNotification: defineEffect("user.createNotification", "user", CreateNotificationPayload),
	deleteMessageNotifications: defineEffect(
		"user.deleteMessageNotifications",
		"user",
		DeleteMessageNotificationsPayload,
	),
}

export const createNotification = Effect.fn("UserEffects.createNotification")(function* (
	payload: CreateNotificationPayload,
) {
	const db = yield* Database.Database
	const own = yield* ownPresence
	// Reading the channel right now (a focused window in use, even while invisible): nothing to tell.
	if (isReading(own.sessions, payload.channelId)) {
		yield* Effect.annotateCurrentSpan({ "notification.skipped": "reading" })
		if (payload.organizationId !== undefined && payload.userId !== undefined) {
			yield* enqueueEffect(
				NotificationCountOrgEffects.notificationsRemoved,
				{ kind: "org", id: payload.organizationId },
				{ channelId: payload.channelId, userId: payload.userId, count: 1 },
			)
		}
		return
	}
	// Do Not Disturb: no sound, no system notification, no push; the unread badge still counts.
	const silent = (payload.silent ?? false) || own.preferred === "dnd"
	const [created] = yield* db.run(
		SQLite.insertInto(schema.notificationsTable)
			.values({
				memberId: payload.memberId,
				targetedResourceId: payload.channelId,
				targetedResourceType: "channel",
				resourceId: payload.messageId,
				resourceType: "message",
				reason: payload.reason ?? null,
				silent,
			})
			.returning("id"),
	)
	if (created === undefined) return
	yield* schedulePush({
		notificationId: created.id,
		channelId: payload.channelId,
		silent,
		content: payload.push,
		presence: own,
	})
})

export const deleteMessageNotifications = Effect.fn("UserEffects.deleteMessageNotifications")(function* (
	payload: typeof DeleteMessageNotificationsPayload.Type,
) {
	if (payload.messageIds.length === 0) return
	const db = yield* Database.Database
	const removed = yield* db.run(
		SQLite.deleteFrom(schema.notificationsTable)
			.where(($) => [$.resourceId.in_(...payload.messageIds), $.resourceType.eq("message")])
			.returning("id"),
	)
	if (removed.length === 0) return
	yield* enqueueEffect(
		NotificationCountOrgEffects.notificationsRemoved,
		{ kind: "org", id: payload.organizationId },
		{ channelId: payload.channelId, userId: payload.userId, count: removed.length },
	)
})

export const messageNotificationReceivers = {
	"user.createNotification": createNotification,
	"user.deleteMessageNotifications": deleteMessageNotifications,
}
