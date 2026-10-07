import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { type AttachmentInfo, byKey, type Lookups, type PresenceInfo, type UserInfo } from "./lookups"
import {
	type AggregatedReaction,
	type AuthorIdentity,
	type ChatMessage,
	type ChatReaction,
	deepEqual,
	type DisplayRow,
	type GroupPosition,
	type MarkdownRefs,
	type MessageRowData,
	type ReplyPreview,
	type StatusEmoji,
	type ThreadPreview,
} from "./rows"

/** Row derivation: grouping, date dividers and every lookup a message row displays. */

const GROUP_THRESHOLD_MS = 3 * 60 * 1000
const THREAD_AUTHORS = 3
const THREAD_AUTHOR_WINDOW = 10

const toGroupPosition = (isGroupStart: boolean, isGroupEnd: boolean): GroupPosition =>
	isGroupStart && isGroupEnd ? "standalone" : isGroupStart ? "start" : isGroupEnd ? "end" : "middle"

/** Lookups indexed once per derivation. */
export interface DeriveContext {
	readonly currentUserId: string | undefined
	readonly users: ReadonlyMap<string, UserInfo>
	readonly presence: ReadonlyMap<string, PresenceInfo>
	readonly botNames: ReadonlyMap<string, string>
	readonly emojiUrls: ReadonlyMap<string, string>
	readonly attachmentsByMessage: ReadonlyMap<string, ReadonlyArray<AttachmentInfo>>
	readonly discordSynced: ReadonlySet<string>
	readonly threadNames: ReadonlyMap<string, string>
	readonly threadMessages: ReadonlyMap<string, ReadonlyArray<Lookups["threadMessages"][number]>>
	readonly replyTargets: ReadonlyMap<string, Lookups["replyTargets"][number]>
}

const groupBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string | null) => {
	const map = new Map<string, A[]>()
	for (const item of items) {
		const k = key(item)
		if (k === null) continue
		const list = map.get(k)
		if (list === undefined) map.set(k, [item])
		else list.push(item)
	}
	return map
}

export const toDeriveContext = (lookups: Lookups, currentUserId: string | undefined): DeriveContext => ({
	currentUserId,
	users: byKey(lookups.users, (user) => user.id),
	presence: byKey(lookups.presence, (presence) => presence.userId),
	botNames: new Map(lookups.bots.map((bot) => [bot.userId, bot.name])),
	emojiUrls: new Map(lookups.customEmojis.map((emoji) => [emoji.name, emoji.imageUrl])),
	attachmentsByMessage: groupBy(lookups.attachments, (attachment) => attachment.messageId),
	discordSynced: new Set(lookups.discordSyncedIds),
	threadNames: new Map(lookups.threadChannels.map((channel) => [channel.id, channel.name])),
	threadMessages: groupBy(lookups.threadMessages, (message) => message.channelId),
	replyTargets: byKey(lookups.replyTargets, (target) => target.id),
})

/** `buildChatAuthorIdentity` with `useBotName`. */
export const authorIdentity = (
	user: Pick<UserInfo, "firstName" | "lastName" | "avatarUrl" | "userType"> | null | undefined,
	botName: string | undefined,
): AuthorIdentity => {
	if (!user) return { displayName: "", avatarUrl: null, isBot: false }
	const isBot = user.userType === "machine"
	const fallback = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
	return { displayName: isBot && botName ? botName : fallback, avatarUrl: user.avatarUrl, isBot }
}

export const identityOf = (context: DeriveContext, userId: string): AuthorIdentity | null => {
	const user = context.users.get(userId)
	return user ? authorIdentity(user, context.botNames.get(userId)) : null
}

/** `processedReactionsAtomFamily` plus the custom emoji image resolution. */
const aggregateReactions = (
	reactions: ReadonlyArray<ChatReaction>,
	context: DeriveContext,
): ReadonlyArray<AggregatedReaction> => {
	const byEmoji = new Map<string, { count: number; hasReacted: boolean; userIds: UserId[] }>()
	for (const reaction of reactions) {
		let entry = byEmoji.get(reaction.emoji)
		if (entry === undefined)
			byEmoji.set(reaction.emoji, (entry = { count: 0, hasReacted: false, userIds: [] }))
		entry.count++
		entry.userIds.push(reaction.userId)
		if (reaction.userId === context.currentUserId) entry.hasReacted = true
	}
	return [...byEmoji].map(([emoji, entry]) => ({
		emoji,
		...entry,
		imageUrl: emoji.startsWith("custom:")
			? (context.emojiUrls.get(emoji.slice("custom:".length)) ?? null)
			: null,
	}))
}

const statusOf = (context: DeriveContext, userId: string): StatusEmoji | null => {
	const presence = context.presence.get(userId)
	return presence?.statusEmoji
		? {
				emoji: presence.statusEmoji,
				message: presence.customMessage,
				expiresAtMs: presence.statusExpiresAtMs,
			}
		: null
}

const replyOf = (context: DeriveContext, replyToMessageId: MessageId | null): ReplyPreview | null => {
	if (replyToMessageId === null) return null
	const target = context.replyTargets.get(replyToMessageId)
	if (target === undefined) return { author: null, firstLine: "" }
	return { author: identityOf(context, target.authorId), firstLine: target.content.split("\n")[0] ?? "" }
}

const threadOf = (context: DeriveContext, threadChannelId: ChannelId | null): ThreadPreview | null => {
	if (threadChannelId === null) return null
	const messages = context.threadMessages.get(threadChannelId) ?? []
	if (messages.length === 0) return null
	const name = context.threadNames.get(threadChannelId)
	const authorIds: string[] = []
	for (const message of messages.slice(0, THREAD_AUTHOR_WINDOW))
		if (!authorIds.includes(message.authorId) && authorIds.length < THREAD_AUTHORS)
			authorIds.push(message.authorId)
	return {
		threadChannelId,
		customName: name && name !== "Thread" ? name : null,
		count: messages.length,
		authors: authorIds.map((authorId) => identityOf(context, authorId)),
		lastReplyAtMs: messages[0]?.createdAtMs ?? null,
	}
}

const MENTION_PATTERN = /@\[userId:([^\]]+)\]/g
const EMOJI_PATTERN = /!\[custom-emoji:([^\]]+)\]/g

const refsOf = (context: DeriveContext, content: string): MarkdownRefs => ({
	mentions: [...content.matchAll(MENTION_PATTERN)].flatMap(([, userId]) => {
		const user = userId ? context.users.get(userId) : undefined
		const name = user
			? (context.botNames.get(user.id) ?? `${user.firstName} ${user.lastName}`)
			: undefined
		return userId && name !== undefined ? [{ userId, name }] : []
	}),
	emojis: [...content.matchAll(EMOJI_PATTERN)].flatMap(([, name]) => {
		const imageUrl = name ? context.emojiUrls.get(name) : undefined
		return name && imageUrl ? [{ name, imageUrl }] : []
	}),
})

const NO_REACTIONS: ReadonlyArray<ChatReaction> = []
const NO_ATTACHMENTS: ReadonlyArray<AttachmentInfo> = []

/** One message row's data; `undefined` fields never appear (Schema structs compare by keys). */
export const messageRowData = (
	message: ChatMessage,
	groupPosition: GroupPosition,
	reactions: ReadonlyArray<ChatReaction>,
	context: DeriveContext,
): MessageRowData => ({
	key: message.id,
	message,
	groupPosition,
	reactions: aggregateReactions(reactions, context),
	author: authorIdentity(message.author, context.botNames.get(message.authorId)),
	status: statusOf(context, message.authorId),
	isDiscordSynced: context.discordSynced.has(message.id),
	reply: replyOf(context, message.replyToMessageId),
	thread: threadOf(context, message.threadChannelId),
	attachments: context.attachmentsByMessage.get(message.id) ?? NO_ATTACHMENTS,
	refs: refsOf(context, message.content),
})

/**
 * Oldest-first rows with a date header before each day; `messagesNewestFirst` is the query order.
 * Rows are plain literals: the tagged-union constructors validate, which costs ms per 10k rows.
 */
export const toDisplayRows = (
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	reactions: ReadonlyArray<ChatReaction>,
	context: DeriveContext,
	previousRows: ReadonlyArray<DisplayRow>,
): ReadonlyArray<DisplayRow> => {
	const previousByKey = new Map(previousRows.map((row) => [row.key, row]))
	const reactionsByMessage = groupBy(reactions, (reaction) => reaction.messageId)
	const rows: DisplayRow[] = []
	let lastDate = ""
	const count = messagesNewestFirst.length
	for (let index = count - 1; index >= 0; index--) {
		const message = messagesNewestFirst[index]!
		const previous = index < count - 1 ? messagesNewestFirst[index + 1]! : null
		const next = index > 0 ? messagesNewestFirst[index - 1]! : null
		const isGroupStart =
			previous === null ||
			message.authorId !== previous.authorId ||
			message.createdAtMs - previous.createdAtMs > GROUP_THRESHOLD_MS ||
			previous.replyToMessageId !== null
		const isGroupEnd =
			next === null ||
			message.authorId !== next.authorId ||
			next.createdAtMs - message.createdAtMs > GROUP_THRESHOLD_MS

		const date = new Date(message.createdAtMs).toDateString()
		if (date !== lastDate) {
			const key = `header-${date}`
			const old = previousByKey.get(key)
			rows.push(
				old !== undefined && old._tag === "DateHeader"
					? old
					: { _tag: "DateHeader", key, label: date },
			)
			lastDate = date
		}

		const data = messageRowData(
			message,
			toGroupPosition(isGroupStart, isGroupEnd),
			reactionsByMessage.get(message.id) ?? NO_REACTIONS,
			context,
		)
		const old = previousByKey.get(message.id)
		rows.push(
			old !== undefined && old._tag === "MessageRow" && old.message === message && sameData(old, data)
				? old
				: { _tag: "MessageRow", ...data },
		)
	}
	return rows
}

const sameData = (old: MessageRowData, data: MessageRowData) =>
	old.groupPosition === data.groupPosition &&
	deepEqual(old.reactions, data.reactions) &&
	deepEqual(old.author, data.author) &&
	deepEqual(old.status, data.status) &&
	old.isDiscordSynced === data.isDiscordSynced &&
	deepEqual(old.reply, data.reply) &&
	deepEqual(old.thread, data.thread) &&
	deepEqual(old.attachments, data.attachments) &&
	deepEqual(old.refs, data.refs)

/** Ids the reply and thread lookups need for this window. */
export const replyIdsOf = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<MessageId> =>
	[
		...new Set(
			messages.flatMap((message) => (message.replyToMessageId ? [message.replyToMessageId] : [])),
		),
	].sort()

export const threadIdsOf = (messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChannelId> =>
	[
		...new Set(messages.flatMap((message) => (message.threadChannelId ? [message.threadChannelId] : []))),
	].sort()
