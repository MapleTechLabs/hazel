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
 * recipient's `UserObject`'s (`user.createNotification`), with what its push says
 * (`./push-content.ts`) when the channel sent the content.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { ChannelId, type ConnectConversationId, MessageId, type OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { NotificationService } from "../../../services/notifications/notification-service"
import { enqueueEffect, defineEffect } from "../effects/registry"
import { MessageNotificationEffects } from "../user/message-notifications"
import { loadPushContent } from "./push-content"

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
	/** For the push (shortened). Optional: deliveries enqueued before push have none. */
	content: Schema.optional(Schema.String),
	/** The message's attachments, counted when it has no text. */
	attachmentCount: Schema.optional(Schema.Number),
})
export type MessageCreatedPayload = typeof MessageCreatedPayload.Type

/** A message deleted in a channel: its notifications go too, so no push shows its text. */
export const MessageDeletedPayload = Schema.Struct({
	channelId: ChannelId,
	messageId: MessageId,
})
export type MessageDeletedPayload = typeof MessageDeletedPayload.Type

export const MessageNotificationOrgEffects = {
	messageCreated: defineEffect("org.messageCreated", "org", MessageCreatedPayload),
	messageDeleted: defineEffect("org.messageDeleted", "org", MessageDeletedPayload),
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

/** Host: run `forward` for every guest org's mount of the conversation. */
type Guest = { readonly organizationId: OrganizationId; readonly channelId: ChannelId }

const forEachGuest = <E, R>(
	conversationId: ConnectConversationId,
	forward: (guest: Guest) => Effect.Effect<unknown, E, R>,
) =>
	Effect.gen(function* () {
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
		yield* Effect.forEach(guests, forward, { discard: true })
	}).pipe(Effect.withSpan("OrgEffects.forEachGuest"))

/**
 * The channel whose members a message in `channelId` concerns here. A Connect guest's message names
 * its own mount: on the host side (the host channel, or a guest's mount copy with no local channel
 * of that id) it is the host channel, and `forward` passes the event on to every guest org.
 */
const notifiedChannel = <E, R>(
	channelId: ChannelId,
	forward: (guest: Guest) => Effect.Effect<unknown, E, R>,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const mount = yield* db.first(
			SQLite.from(schema.connectConversationChannelsTable)
				.select("conversationId", "role")
				.where(($) => [$.channelId.eq(channelId), $.isActive.eq(true), $.deletedAt.isNull()])
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
		const hosted =
			Option.isSome(mount) &&
			Option.isSome(conversation) &&
			(mount.value.role === "host" || Option.isNone(yield* localChannel(channelId)))
		if (!hosted) return yield* localChannel(channelId)
		yield* forEachGuest(conversation.value.id, forward)
		return yield* localChannel(conversation.value.hostChannelId)
	}).pipe(Effect.withSpan("OrgEffects.notifiedChannel"))

export const messageCreated = Effect.fn("OrgEffects.messageCreated")(function* (
	input: MessageCreatedPayload,
) {
	const channel = yield* notifiedChannel(input.channelId, (guest) =>
		enqueueEffect(
			MessageNotificationOrgEffects.messageCreated,
			{ kind: "org", id: guest.organizationId },
			{ ...input, channelId: guest.channelId },
			{ id: `connect-notify:${input.messageId}:${guest.organizationId}` },
		),
	)
	if (channel._tag === "None") return
	const payload = { ...input, channelId: channel.value.id }
	const content = payload.content

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
			// Worked out only when some recipient's notification is not silent.
			push:
				content === undefined
					? undefined
					: loadPushContent({
							organizationId: channel.value.organizationId,
							channelId: payload.channelId,
							authorId: payload.authorId,
							mentionedUserIds: payload.mentionedUserIds,
							content,
							attachmentCount: payload.attachmentCount ?? 0,
						}),
		}),
	).pipe(Effect.provide(NotificationService.layer))
})

/**
 * Drop the message's notifications in the `UserObject`s that may hold one: the channel's members
 * with unread notifications there (`notificationCount`, reset when they read it).
 */
export const messageDeleted = Effect.fn("OrgEffects.messageDeleted")(function* (
	input: MessageDeletedPayload,
) {
	const channel = yield* notifiedChannel(input.channelId, (guest) =>
		enqueueEffect(
			MessageNotificationOrgEffects.messageDeleted,
			{ kind: "org", id: guest.organizationId },
			{ ...input, channelId: guest.channelId },
			{ id: `connect-unnotify:${input.messageId}:${guest.organizationId}` },
		),
	)
	if (channel._tag === "None") return
	const db = yield* Database.Database
	const members = yield* db.run(
		SQLite.from(schema.channelMembersTable)
			.select("userId")
			.where(($) => [
				$.channelId.eq(channel.value.id),
				// Members who left since keep their notifications: theirs go too.
				$.notificationCount.gt(0),
			]),
	)
	yield* Effect.forEach(
		members,
		({ userId }) =>
			enqueueEffect(
				MessageNotificationEffects.deleteMessageNotifications,
				{ kind: "user", id: userId },
				{ messageIds: [input.messageId] },
				{ id: `unnotify:${input.messageId}:${userId}` },
			),
		{ discard: true },
	)
	yield* Effect.annotateCurrentSpan({ "notification.recipients": members.length })
})

export const messageNotificationOrgReceivers = {
	"org.messageCreated": messageCreated,
	"org.messageDeleted": messageDeleted,
}
