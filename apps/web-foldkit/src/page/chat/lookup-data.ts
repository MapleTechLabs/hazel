import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Stream } from "effect"
import {
	attachmentCollection,
	botCollection,
	channelCollection,
	channelMemberCollection,
	chatSyncChannelLinkCollection,
	chatSyncConnectionCollection,
	chatSyncMessageLinkCollection,
	customEmojiCollection,
	messageCollection,
	organizationCollection,
	pinnedMessageCollection,
	typingIndicatorCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { getAttachmentUrl } from "~/utils/attachment-url"
import { liveQueryStream } from "../../data/live-query"
import {
	type AttachmentInfo,
	type AttachmentRow,
	type BotInfo,
	type ChannelMemberInfo,
	type ChannelMemberRow,
	type CustomEmojiInfo,
	type PinnedInfo,
	type PresenceInfo,
	type PresenceRow,
	type ReplyTarget,
	type ThreadChannelInfo,
	type ThreadMessageInfo,
	type TypingInfo,
	type UserInfo,
	type UserRow,
	toChannelMemberInfo,
	toPresenceInfo,
	toUserInfo,
} from "./lookups"

/** Live queries behind the page's lookups; each mirrors the legacy hook or atom it replaces. */

export const usersStream = <M>(toMessage: (users: ReadonlyArray<UserInfo>) => M) =>
	liveQueryStream<UserRow, M>(
		(q) => q.from({ user: userCollection }).orderBy(({ user }) => user.createdAt, "desc"),
		(rows) => toMessage(rows.map(toUserInfo)),
	)

export const presenceStream = <M>(toMessage: (presence: ReadonlyArray<PresenceInfo>) => M) =>
	liveQueryStream<PresenceRow, M>(
		(q) => q.from({ presence: userPresenceStatusCollection }),
		(rows) => toMessage(rows.map(toPresenceInfo)),
	)

/** `useBotName`, for every bot at once. */
export const botsStream = <M>(toMessage: (bots: ReadonlyArray<BotInfo>) => M) =>
	liveQueryStream<{ userId: UserId; name: string }, M>(
		(q) =>
			q
				.from({ bot: botCollection })
				.where(({ bot }) => isNull(bot.deletedAt))
				.select(({ bot }) => ({ userId: bot.userId, name: bot.name })),
		(rows) => toMessage(rows.map((row) => ({ userId: row.userId, name: row.name }))),
	)

/** `customEmojisForOrgAtomFamily`. */
export const customEmojisStream = <M>(
	organizationId: OrganizationId,
	toMessage: (emojis: ReadonlyArray<CustomEmojiInfo>) => M,
) =>
	liveQueryStream<{ name: string; imageUrl: string }, M>(
		(q) =>
			q
				.from({ emoji: customEmojiCollection })
				.where((q) => and(eq(q.emoji.organizationId, organizationId), isNull(q.emoji.deletedAt))),
		(rows) => toMessage(rows.map((row) => ({ name: row.name, imageUrl: row.imageUrl }))),
	)

/** `useAttachments`, for the whole channel (rows are grouped by message when deriving). */
export const attachmentsStream = <M>(
	channelId: ChannelId,
	toMessage: (attachments: ReadonlyArray<AttachmentInfo>) => M,
) =>
	liveQueryStream<AttachmentRow, M>(
		(q) =>
			q
				.from({ attachments: attachmentCollection })
				.where(({ attachments }) => eq(attachments.channelId, channelId))
				.orderBy(({ attachments }) => attachments.uploadedAt, "asc"),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					id: row.id,
					messageId: row.messageId ?? null,
					fileName: row.fileName,
					fileSize: row.fileSize,
					url: getAttachmentUrl(row),
					uploadedAtMs: new Date(row.uploadedAt).getTime(),
				})),
			),
	)

/** `isDiscordSyncedMessageAtomFamily`, scoped to the channel's link instead of one message. */
export const discordSyncedStream = <M>(
	channelId: ChannelId,
	toMessage: (ids: ReadonlyArray<MessageId>) => M,
) =>
	liveQueryStream<{ hazelMessageId: MessageId }, M>(
		(q) =>
			q
				.from({ messageLink: chatSyncMessageLinkCollection })
				.innerJoin({ channelLink: chatSyncChannelLinkCollection }, ({ messageLink, channelLink }) =>
					eq(messageLink.channelLinkId, channelLink.id),
				)
				.innerJoin({ connection: chatSyncConnectionCollection }, ({ channelLink, connection }) =>
					eq(channelLink.syncConnectionId, connection.id),
				)
				.where(({ messageLink, channelLink, connection }) =>
					and(
						eq(channelLink.hazelChannelId, channelId),
						eq(messageLink.source, "external"),
						eq(connection.provider, "discord"),
						isNull(messageLink.deletedAt),
						isNull(channelLink.deletedAt),
						isNull(connection.deletedAt),
					),
				)
				.select(({ messageLink }) => ({ hazelMessageId: messageLink.hazelMessageId })),
		(rows) => toMessage(rows.map((row) => row.hazelMessageId)),
	)

/** Thread names for `InlineThreadPreview`. */
export const threadChannelsStream = <M>(
	threadIds: ReadonlyArray<ChannelId>,
	toMessage: (channels: ReadonlyArray<ThreadChannelInfo>) => M,
) =>
	threadIds.length === 0
		? Stream.make(toMessage([]))
		: liveQueryStream<{ id: ChannelId; name: string }, M>(
				(q) =>
					q
						.from({ channel: channelCollection })
						.where(({ channel }) => inArray(channel.id, [...threadIds])),
				(rows) => toMessage(rows.map((row) => ({ id: row.id, name: row.name }))),
			)

/** Thread messages for the reply count, avatar stack and last reply time. */
export const threadMessagesStream = <M>(
	threadIds: ReadonlyArray<ChannelId>,
	toMessage: (messages: ReadonlyArray<ThreadMessageInfo>) => M,
) =>
	threadIds.length === 0
		? Stream.make(toMessage([]))
		: liveQueryStream<{ id: MessageId; channelId: ChannelId; authorId: UserId; createdAt: Date }, M>(
				(q) =>
					q
						.from({ message: messageCollection })
						.where(({ message }) => inArray(message.channelId, [...threadIds]))
						.orderBy(({ message }) => message.createdAt, "desc"),
				(rows) =>
					toMessage(
						rows.map((row) => ({
							id: row.id,
							channelId: row.channelId,
							authorId: row.authorId,
							createdAtMs: new Date(row.createdAt).getTime(),
						})),
					),
			)

/** `messageWithAuthorAtomFamily` for every replied-to message (inner join: no author, no row). */
export const replyTargetsStream = <M>(
	messageIds: ReadonlyArray<MessageId>,
	toMessage: (targets: ReadonlyArray<ReplyTarget>) => M,
) =>
	messageIds.length === 0
		? Stream.make(toMessage([]))
		: liveQueryStream<{ id: MessageId; authorId: UserId; content: string }, M>(
				(q) =>
					q
						.from({ message: messageCollection })
						.innerJoin({ author: userCollection }, ({ message, author }) =>
							eq(message.authorId, author.id),
						)
						.where(({ message }) => inArray(message.id, [...messageIds]))
						.select(({ message }) => ({
							id: message.id,
							authorId: message.authorId,
							content: message.content,
						})),
				(rows) =>
					toMessage(
						rows.map((row) => ({ id: row.id, authorId: row.authorId, content: row.content })),
					),
			)

/** The channel's members (`useIsChannelMember`, typing names, DM header). */
export const membersStream = <M>(
	channelId: ChannelId,
	toMessage: (members: ReadonlyArray<ChannelMemberInfo>) => M,
) =>
	liveQueryStream<ChannelMemberRow, M>(
		(q) =>
			q
				.from({ member: channelMemberCollection })
				.where(({ member }) => eq(member.channelId, channelId))
				.orderBy(({ member }) => member.createdAt, "desc"),
		(rows) => toMessage(rows.map(toChannelMemberInfo)),
	)

/** `useTypingIndicators`' indicator query. */
export const typingStream = <M>(channelId: ChannelId, toMessage: (typing: ReadonlyArray<TypingInfo>) => M) =>
	liveQueryStream<TypingInfo, M>(
		(q) =>
			q
				.from({ typing: typingIndicatorCollection })
				.where(({ typing }) => eq(typing.channelId, channelId))
				.orderBy(({ typing }) => typing.lastTyped, "desc")
				.limit(10),
		(rows) => toMessage(rows.map((row) => ({ memberId: row.memberId, lastTyped: row.lastTyped }))),
	)

/** The org's slug, for links (`useOrganization().slug`). */
export const orgSlugStream = <M>(organizationId: OrganizationId, toMessage: (orgSlug: string | null) => M) =>
	liveQueryStream<{ slug: string | null }, M>(
		(q) =>
			q
				.from({ org: organizationCollection })
				.where(({ org }) => eq(org.id, organizationId))
				.findOne(),
		(rows) => toMessage(rows[0]?.slug ?? null),
	)

interface PinnedRow {
	readonly pinned: { readonly id: string; readonly messageId: MessageId; readonly pinnedAt: Date }
	readonly message: {
		readonly authorId: UserId
		readonly content: string
		readonly createdAt: Date
		readonly updatedAt: Date | null
		readonly author?: {
			readonly firstName: string
			readonly lastName: string
			readonly avatarUrl?: string | null
		} | null
	}
}

/** `PinnedMessagesModal`'s query, sorted by pin time like its `sortedPins`. */
export const pinnedStream = <M>(channelId: ChannelId, toMessage: (pins: ReadonlyArray<PinnedInfo>) => M) =>
	liveQueryStream<PinnedRow, M>(
		(q) =>
			q
				.from({ pinned: pinnedMessageCollection })
				.where(({ pinned }) => eq(pinned.channelId, channelId))
				.innerJoin({ message: messageCollection }, ({ pinned, message }) =>
					eq(pinned.messageId, message.id),
				)
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.select(({ pinned, message, author }) => ({ pinned, message: { ...message, author } }))
				.orderBy(({ pinned }) => pinned.pinnedAt, "desc"),
		(rows) =>
			toMessage(
				rows
					.map((row) => ({
						pinnedId: row.pinned.id,
						messageId: row.pinned.messageId,
						authorId: row.message.authorId,
						author: row.message.author
							? {
									firstName: row.message.author.firstName,
									lastName: row.message.author.lastName,
									avatarUrl: row.message.author.avatarUrl ?? null,
								}
							: null,
						content: row.message.content,
						createdAtMs: new Date(row.message.createdAt).getTime(),
						updatedAtMs:
							row.message.updatedAt === null ? null : new Date(row.message.updatedAt).getTime(),
						pinnedAtMs: new Date(row.pinned.pinnedAt).getTime(),
					}))
					.sort((a, b) => a.pinnedAtMs - b.pinnedAtMs),
			),
	)
