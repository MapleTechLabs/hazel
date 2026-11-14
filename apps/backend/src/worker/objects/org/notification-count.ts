/**
 * `org.notificationsRemoved`: a member's `UserObject` dropped `count` of their notifications in a
 * channel without them reading it (the message was deleted), so the channel's unread count
 * (`channel_members.notificationCount`) comes down by as many, never below 0 (reading the
 * channel may have reset it first). Only that user's own object may send it.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { defineEffect, type EffectSender } from "../effects/registry"

export const NotificationsRemovedPayload = Schema.Struct({
	channelId: ChannelId,
	userId: UserId,
	count: Schema.Int.check(Schema.isGreaterThan(0)),
})
export type NotificationsRemovedPayload = typeof NotificationsRemovedPayload.Type

export const NotificationCountOrgEffects = {
	notificationsRemoved: defineEffect("org.notificationsRemoved", "org", NotificationsRemovedPayload),
}

export const notificationsRemoved = Effect.fn("OrgEffects.notificationsRemoved")(function* (
	payload: NotificationsRemovedPayload,
) {
	const db = yield* Database.Database
	yield* db.run(
		SQLite.update(schema.channelMembersTable)
			.set(($) => ({ notificationCount: $.notificationCount.add(-payload.count) }))
			.where(($) => [
				$.channelId.eq(payload.channelId),
				$.userId.eq(payload.userId),
				$.notificationCount.gte(payload.count),
			]),
	)
	yield* db.run(
		SQLite.update(schema.channelMembersTable)
			.set({ notificationCount: 0 })
			.where(($) => [
				$.channelId.eq(payload.channelId),
				$.userId.eq(payload.userId),
				$.notificationCount.lt(payload.count),
				$.notificationCount.gt(0),
			]),
	)
})

export const notificationCountOrgReceivers = {
	"org.notificationsRemoved": notificationsRemoved,
}

/** `org.notificationsRemoved` only from the `UserObject` of the user it names. */
export const notificationCountSenderRefusal = (kind: string, payload: unknown, sender: EffectSender) =>
	kind !== NotificationCountOrgEffects.notificationsRemoved.name ||
	(sender.kind === "user" && sender.id === (payload as NotificationsRemovedPayload).userId)
		? Option.none<string>()
		: Option.some(`${kind} must come from the named user's object`)
