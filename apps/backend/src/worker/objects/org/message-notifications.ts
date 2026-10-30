/**
 * `org.messageCreated`: who a new message notifies, decided by the channel's `OrgObject`. The
 * `ChannelObject` sends what only it knows (mentions, the replied-to author); the org owns the
 * rest: the channel's type, its `channel_members` (muted, left), presence, and the members'
 * `organization_members` ids.
 *
 * - A DM or group DM, `@channel` or `@here`: every member but the author.
 * - Otherwise the mentioned users and the replied-to author.
 * - Never a muted member, nor one viewing the channel right now (online, active in it) or
 *   suppressing notifications.
 *
 * Each recipient's `notificationCount` goes up here; the notification row itself is the
 * recipient's `UserObject`'s (`user.createNotification`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	ChannelId,
	type ConnectConversationId,
	MessageId,
	type OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Array, Effect, Option, Schema } from "effect"
import { enqueueEffect, defineEffect } from "../effects/registry"
import { MessageNotificationEffects } from "../user/message-notifications"

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
				.select("id", "type", "organizationId")
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

	const everyone = channel.value.type === "direct" || channel.value.type === "single" || payload.notifyAll
	const targets = Array.dedupe([
		...payload.mentionedUserIds,
		...(payload.replyToAuthorId === null ? [] : [payload.replyToAuthorId]),
	]).filter((userId) => userId !== payload.authorId)
	yield* Effect.annotateCurrentSpan({
		"notification.mode": everyone ? "all" : "targeted",
		"notification.targets": targets.length,
	})
	if (!everyone && targets.length === 0) return

	const members = yield* db.run(
		SQLite.from(schema.channelMembersTable)
			.leftJoin(schema.userPresenceStatusTable, "presence", (member, presence) =>
				presence.userId.eq(member.userId),
			)
			.select("id", "userId")
			.where(($) => [
				$.channelId.eq(payload.channelId),
				$.isMuted.eq(false),
				$.userId.neq(payload.authorId),
				$.deletedAt.isNull(),
				...(everyone ? [] : [$.userId.in_(...targets)]),
				SQLite.or(
					$.presence.userId.isNull(),
					SQLite.and(
						$.presence.suppressNotifications.eq(false),
						SQLite.or(
							$.presence.activeChannelId.isNull(),
							$.presence.activeChannelId.neq(payload.channelId),
							$.presence.status.neq("online"),
						),
					),
				),
			]),
	)
	if (members.length === 0) return

	const orgMembers = yield* db.run(
		SQLite.from(schema.organizationMembersTable)
			.select("id", "userId")
			.where(($) => [
				$.organizationId.eq(channel.value.organizationId),
				$.userId.in_(...members.map((member) => member.userId)),
				$.deletedAt.isNull(),
			]),
	)
	const memberIdOf = new Map<UserId, OrganizationMemberId>(orgMembers.map((row) => [row.userId, row.id]))
	const recipients = members.filter((member) => memberIdOf.has(member.userId))
	if (recipients.length === 0) return

	yield* db.run(
		SQLite.update(schema.channelMembersTable)
			.set(($) => ({ notificationCount: $.notificationCount.add(1) }))
			.where(($) => [$.id.in_(...recipients.map((member) => member.id))]),
	)
	yield* Effect.forEach(
		recipients,
		(member) =>
			enqueueEffect(
				MessageNotificationEffects.createNotification,
				{ kind: "user", id: member.userId },
				{
					memberId: memberIdOf.get(member.userId)!,
					channelId: payload.channelId,
					messageId: payload.messageId,
				},
				{ id: `notify:${payload.messageId}:${member.userId}` },
			),
		{ discard: true },
	)
	yield* Effect.annotateCurrentSpan({ "notification.recipients": recipients.length })
})

export const messageNotificationOrgReceivers = {
	"org.messageCreated": messageCreated,
}
