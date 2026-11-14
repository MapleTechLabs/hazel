/**
 * `user.createNotification`: a message notification for the `UserObject`'s owner, from the
 * channel's `OrgObject` (`../org/message-notifications.ts`). `memberId` is the owner's
 * `organization_members` id in that org, as the client's notifications collection expects.
 * `push` is what the owner's phones show, if it is pushed (`./push.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, MessageId, OrganizationMemberId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { NotificationReasons } from "../../../services/notifications/notification-rules"
import { defineEffect } from "../effects/registry"
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
})
export type CreateNotificationPayload = typeof CreateNotificationPayload.Type

export const MessageNotificationEffects = {
	createNotification: defineEffect("user.createNotification", "user", CreateNotificationPayload),
}

export const createNotification = Effect.fn("UserEffects.createNotification")(function* (
	payload: CreateNotificationPayload,
) {
	const db = yield* Database.Database
	const [created] = yield* db.run(
		SQLite.insertInto(schema.notificationsTable)
			.values({
				memberId: payload.memberId,
				targetedResourceId: payload.channelId,
				targetedResourceType: "channel",
				resourceId: payload.messageId,
				resourceType: "message",
				reason: payload.reason ?? null,
				silent: payload.silent ?? false,
			})
			.returning("id"),
	)
	yield* schedulePush({
		notificationId: created!.id,
		channelId: payload.channelId,
		silent: payload.silent ?? false,
		content: payload.push,
	})
})

export const messageNotificationReceivers = {
	"user.createNotification": createNotification,
}
