/**
 * `user.createNotification`: a message notification for the `UserObject`'s owner, from the
 * channel's `OrgObject` (`../org/message-notifications.ts`). `memberId` is the owner's
 * `organization_members` id in that org, as the client's notifications collection expects.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, MessageId, OrganizationMemberId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineEffect } from "../effects/registry"

export const CreateNotificationPayload = Schema.Struct({
	memberId: OrganizationMemberId,
	channelId: ChannelId,
	messageId: MessageId,
})
export type CreateNotificationPayload = typeof CreateNotificationPayload.Type

export const MessageNotificationEffects = {
	createNotification: defineEffect("user.createNotification", "user", CreateNotificationPayload),
}

export const createNotification = Effect.fn("UserEffects.createNotification")(function* (
	payload: CreateNotificationPayload,
) {
	const db = yield* Database.Database
	yield* db.run(
		SQLite.insertInto(schema.notificationsTable).values({
			memberId: payload.memberId,
			targetedResourceId: payload.channelId,
			targetedResourceType: "channel",
			resourceId: payload.messageId,
			resourceType: "message",
		}),
	)
})

export const messageNotificationReceivers = {
	"user.createNotification": createNotification,
}
