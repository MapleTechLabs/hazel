/**
 * `org.messageCreated`: who a new message notifies, decided by the channel's `OrgObject`. The
 * `ChannelObject` sends what only it knows (mentions, the replied-to author); the org owns the
 * rest: the channel's type, its `channel_members` (muted, left), presence, and the members'
 * `organization_members` ids.
 *
 * Who it notifies, and how, is `NotificationService`'s (`services/notifications/`): Discord's
 * levels (all, mentions, nothing), mutes, presence, do not disturb and quiet hours.
 *
 * Each recipient's `notificationCount` goes up here; the notification row itself is the
 * recipient's `UserObject`'s (`user.createNotification`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, type ConnectConversationId, MessageId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { NotificationService } from "../../../services/notifications/notification-service"
import { enqueueEffect, defineEffect } from "../effects/registry"

export const MessageCreatedPayload = Schema.Struct({
	channelId: ChannelId,
	messageId: MessageId,
	authorId: UserId,
	/** `@[userId:…]` mentions in the content. */
	mentionedUserIds: Schema.Array(UserId),
	/** `@channel` or `@here`. */
	notifyAll: Schema.Boolean,
	/** The author of the message this one replies to. */
	replyToAuthorId: Schema.NullOr(UserId),
})
export type MessageCreatedPayload = typeof MessageCreatedPayload.Type

export const MessageNotificationOrgEffects = {
	messageCreated: defineEffect("org.messageCreated", "org", MessageCreatedPayload),
}

const localChannel = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.channelsTable)
				.select("id", "type", "organizationId", "parentChannelId")
				.where(($) => [$.id.eq(channelId), $.deletedAt.isNull()])
				.limit(1),
		),
	)

/** Host: send the message's notifications to every guest org of the conversation. */
const forwardToGuests = Effect.fn("OrgEffects.forwardToGuests")(function* (
	conversationId: ConnectConversationId,
	payload: MessageCreatedPayload,
) {
	const db = yield* Database.Database
	const guests = yield* db.run(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("organizationId", "channelId")
			.where(($) => [
				$.conversationId.eq(conversationId),
				$.role.eq("guest"),
				$.isActive.eq(true),
				$.deletedAt.isNull(),
			]),
	)
	yield* Effect.forEach(
		guests,
		(guest) =>
			enqueueEffect(
				MessageNotificationOrgEffects.messageCreated,
				{ kind: "org", id: guest.organizationId },
				{ ...payload, channelId: guest.channelId },
				{ id: `connect-notify:${payload.messageId}:${guest.organizationId}` },
			),
		{ discard: true },
	)
})

export const messageCreated = Effect.fn("OrgEffects.messageCreated")(function* (
	input: MessageCreatedPayload,
) {
	let payload = input
	const db = yield* Database.Database
	// A Connect guest's message names its own mount: notify the host channel's members here.
	const mount = yield* db.first(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("conversationId", "role")
			.where(($) => [$.channelId.eq(payload.channelId), $.isActive.eq(true), $.deletedAt.isNull()])
			.limit(1),
	)
	const conversation = Option.isNone(mount)
		? Option.none()
		: yield* db.first(
				SQLite.from(schema.connectConversationsTable)
					.select("id", "hostChannelId")
					.where(($) => [$.id.eq(mount.value.conversationId), $.deletedAt.isNull()])
					.limit(1),
			)
	// Host side: the host channel, or a guest's mount copy (no local channel of that id).
	const hosted =
		Option.isSome(mount) &&
		Option.isSome(conversation) &&
		(mount.value.role === "host" || Option.isNone(yield* localChannel(payload.channelId)))
	if (hosted) {
		yield* forwardToGuests(conversation.value.id, payload)
		payload = { ...payload, channelId: conversation.value.hostChannelId }
	}
	const channel = yield* localChannel(payload.channelId)
	if (channel._tag === "None") return

	yield* NotificationService.use((service) =>
		service.notify(channel.value.organizationId, {
			channelId: payload.channelId,
			channelType: channel.value.type,
			parentChannelId: channel.value.parentChannelId,
			messageId: payload.messageId,
			authorId: payload.authorId,
			mentionedUserIds: payload.mentionedUserIds,
			notifyAll: payload.notifyAll,
			replyToAuthorId: payload.replyToAuthorId,
		}),
	).pipe(Effect.provide(NotificationService.layer))
})

export const messageNotificationOrgReceivers = {
	"org.messageCreated": messageCreated,
}
