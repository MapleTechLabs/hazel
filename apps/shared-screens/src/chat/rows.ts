/**
 * The message list's entries from its data: today's grouping, date dividers and "New" line
 * (`web-foldkit/src/page/chat/derive.ts` `toDisplayRows`), each message shaped into the row data the
 * `message` primitive draws. Pure, so the grouping is tested without a host.
 */
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import type { Content, MessageAction } from "@hazel/ui/vocabulary/index"
import { dateLabel, distanceStrict, formatBytes, formatTime, initialsOf } from "./format"
import { type Names, parseMarkdown, plainLine } from "./rich-text"

/** A message as its query gives it. */
export interface ChatMessage {
	readonly id: MessageId
	readonly channelId: ChannelId
	readonly authorId: UserId
	readonly content: string
	readonly createdAtMs: number
	readonly updatedAtMs: number | null
	readonly replyToMessageId: MessageId | null
	readonly threadChannelId: ChannelId | null
	readonly isPinned: boolean
	/** The pin's id, which unpinning names. */
	readonly pinnedId: string | null
	/** Link previews and bot cards that carry a url (`message.embeds`). */
	readonly embeds: ReadonlyArray<Content.Embed>
}

export interface ChatUser {
	readonly id: UserId
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl: string | null
	readonly userType: string
	readonly email: string | null
	readonly timezone?: string | null
}

export interface ChatReaction {
	readonly messageId: MessageId
	readonly userId: UserId
	readonly emoji: string
}

export interface ChatAttachment {
	readonly id: string
	readonly messageId: MessageId | null
	readonly fileName: string
	readonly fileSize: number
	readonly url: string
}

/** A thread's card: its name and its messages, newest first. */
export interface ChatThread {
	readonly name: string
	readonly messages: ReadonlyArray<Pick<ChatMessage, "authorId" | "content" | "createdAtMs">>
}

/** Everything a row reads besides its message. */
export interface Lookups {
	readonly currentUserId: UserId
	readonly users: ReadonlyMap<string, ChatUser>
	readonly botNames: ReadonlyMap<string, string>
	readonly groupHandles: ReadonlyMap<string, string>
	readonly reactions: ReadonlyMap<string, ReadonlyArray<ChatReaction>>
	readonly attachments: ReadonlyMap<string, ReadonlyArray<ChatAttachment>>
	readonly threads: ReadonlyMap<string, ChatThread>
	/** Replied-to messages, loaded or not in the window. */
	readonly replyTargets: ReadonlyMap<string, Pick<ChatMessage, "authorId" | "content">>
	/** Custom emoji images by name, for `custom:<name>` reactions. */
	readonly emojiUrls: ReadonlyMap<string, string>
	readonly nowMs: number
}

/** One message row: its key, the primitive's data and its flags. */
export interface RowEntry {
	readonly _tag: "Row"
	readonly key: MessageId
	readonly authorId: UserId
	readonly threadChannelId: ChannelId | null
	readonly isPinned: boolean
	readonly isOwn: boolean
	readonly grouped: boolean
	readonly entering: boolean
	readonly row: Content.MessageRow
}

export type Entry =
	| { readonly _tag: "Date"; readonly key: string; readonly label: string }
	| { readonly _tag: "Unread"; readonly key: string }
	| RowEntry

/** Messages within this of each other, by one author, share a header. */
export const GROUP_THRESHOLD_MS = 3 * 60 * 1000
/** The toolbar's quick reactions (today's first three `TOP_EMOJIS`). */
export const QUICK_EMOJIS = ["👍", "❤️", "😂"] as const
/** More arrivals than this at once are a catch-up, not someone writing (today's `MAX_ENTERING`). */
const MAX_ENTERING = 3

/** A chat sync shadow user's platform, from their address (today's `shadowProviderOf`). */
export const providerOf = (user: ChatUser): "slack" | "discord" | undefined =>
	user.userType !== "machine"
		? undefined
		: user.email?.startsWith("discord-user-")
			? "discord"
			: user.email?.startsWith("slack-user-")
				? "slack"
				: undefined

export const displayNameOf = (lookups: Lookups, userId: string) => {
	const user = lookups.users.get(userId)
	if (user === undefined) return undefined
	const bot = lookups.botNames.get(userId)
	const isBot = user.userType === "machine" && providerOf(user) === undefined
	return isBot && bot !== undefined ? bot : `${user.firstName} ${user.lastName}`.trim()
}

export const namesOf = (lookups: Lookups): Names => ({
	user: (id) => displayNameOf(lookups, id),
	group: (id) => lookups.groupHandles.get(id),
})

/** Drops absent keys, so equal rows compare equal and the wire never carries `undefined`. */
const compact = <A extends object>(value: A): A =>
	// SAFETY: the same object minus keys whose value is undefined, which `A`'s optional keys allow.
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as A

const reactionsOf = (lookups: Lookups, messageId: MessageId) => {
	const reactions = lookups.reactions.get(messageId)
	if (reactions === undefined || reactions.length === 0) return undefined
	const byEmoji = new Map<string, { count: number; mine: boolean; names: Array<string> }>()
	for (const reaction of reactions) {
		let entry = byEmoji.get(reaction.emoji)
		if (entry === undefined) byEmoji.set(reaction.emoji, (entry = { count: 0, mine: false, names: [] }))
		entry.count++
		if (reaction.userId === lookups.currentUserId) entry.mine = true
		const name = displayNameOf(lookups, reaction.userId)
		if (name !== undefined) entry.names.push(name)
	}
	return [...byEmoji].map(([emoji, entry]): Content.Reaction => {
		const custom = emoji.startsWith("custom:") ? lookups.emojiUrls.get(emoji.slice(7)) : undefined
		return {
			emoji: custom ?? emoji,
			count: entry.count,
			mine: entry.mine,
			who: { names: entry.names.slice(0, 3), others: Math.max(0, entry.count - 3) },
		}
	})
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|heic|svg)$/i
const VIDEO = /\.(mp4|mov|webm|m4v)$/i

const filesOf = (lookups: Lookups, messageId: MessageId) => {
	const files = lookups.attachments.get(messageId)
	if (files === undefined || files.length === 0) return undefined
	return files.map((file): Content.Attachment => ({
		id: file.id,
		kind: IMAGE.test(file.fileName) ? "image" : VIDEO.test(file.fileName) ? "video" : "file",
		name: file.fileName,
		size: formatBytes(file.fileSize),
		url: file.url,
	}))
}

const threadOf = (lookups: Lookups, names: Names, threadChannelId: ChannelId | null) => {
	if (threadChannelId === null) return undefined
	const thread = lookups.threads.get(threadChannelId)
	const last = thread?.messages[0]
	if (thread === undefined || last === undefined) return undefined
	const author = displayNameOf(lookups, last.authorId) ?? ""
	const avatar = lookups.users.get(last.authorId)?.avatarUrl ?? undefined
	return compact<Content.ThreadSummary>({
		name: thread.name || "Thread",
		count: thread.messages.length,
		author,
		initials: initialsOf(author),
		avatar,
		preview: plainLine(last.content, names),
		time: distanceStrict(last.createdAtMs, lookups.nowMs),
	})
}

const replyOf = (lookups: Lookups, names: Names, replyTo: MessageId | null) => {
	if (replyTo === null) return undefined
	const target = lookups.replyTargets.get(replyTo)
	if (target === undefined) return undefined
	const author = displayNameOf(lookups, target.authorId) ?? ""
	const avatar = lookups.users.get(target.authorId)?.avatarUrl ?? undefined
	return compact<NonNullable<Content.MessageRow["reply"]>>({
		author,
		initials: initialsOf(author),
		avatar,
		text: plainLine(target.content, names),
	})
}

/** What the row offers: today's toolbar (react, copy, edit, reply, delete) and its More menu. */
export const actionsOf = (isOwn: boolean, isPinned: boolean): ReadonlyArray<MessageAction> => [
	"react",
	"copy",
	...(isOwn ? (["edit"] as const) : []),
	"reply",
	"thread",
	isPinned ? "unpin" : "pin",
	"selectText",
	...(isOwn ? (["delete"] as const) : []),
]

/** A message's row data; the header fields are left out on a grouped row. */
export const messageRow = (message: ChatMessage, grouped: boolean, lookups: Lookups): Content.MessageRow => {
	const names = namesOf(lookups)
	const user = lookups.users.get(message.authorId)
	const author = displayNameOf(lookups, message.authorId)
	const isOwn = message.authorId === lookups.currentUserId
	const reply = replyOf(lookups, names, message.replyToMessageId)
	const showHeader = !grouped || reply !== undefined
	return compact({
		author: showHeader ? author : undefined,
		initials: showHeader && author !== undefined ? initialsOf(author) : undefined,
		avatar: showHeader ? (user?.avatarUrl ?? undefined) : undefined,
		provider: showHeader && user !== undefined ? providerOf(user) : undefined,
		time: formatTime(message.createdAtMs),
		body: parseMarkdown(message.content, names),
		reactions: reactionsOf(lookups, message.id),
		quick: [...QUICK_EMOJIS],
		edited:
			message.updatedAtMs !== null && message.updatedAtMs - message.createdAtMs > 1000
				? true
				: undefined,
		reply,
		files: filesOf(lookups, message.id),
		embeds: message.embeds.length === 0 ? undefined : message.embeds,
		thread: threadOf(lookups, names, message.threadChannelId),
		actions: actionsOf(isOwn, message.isPinned),
	})
}

/** Messages that arrived live: newer than every previous row, and only a few at once. */
const enteringOf = (
	messages: ReadonlyArray<ChatMessage>,
	previous: ReadonlyMap<string, RowEntry>,
): ReadonlySet<string> => {
	if (previous.size === 0) return new Set()
	let newest = Number.NEGATIVE_INFINITY
	for (const message of messages)
		if (previous.has(message.id) && message.createdAtMs > newest) newest = message.createdAtMs
	const entering = new Set<string>()
	for (const message of messages) {
		if (previous.has(message.id) || message.createdAtMs <= newest) continue
		if (entering.size === MAX_ENTERING) return new Set()
		entering.add(message.id)
	}
	return entering
}

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Same flags and same data: the previous entry is kept, so its props stay `===`. */
const isSameRow = (a: RowEntry, b: RowEntry) =>
	a.grouped === b.grouped &&
	a.entering === b.entering &&
	a.isPinned === b.isPinned &&
	a.threadChannelId === b.threadChannelId &&
	sameJson(a.row, b.row)

/**
 * Oldest-first entries from the window (`messagesNewestFirst`, the query's order): a date divider
 * before each day, the "New" line before `firstNewId`. A row equal to its previous entry is that
 * entry, so hosts redraw only the rows that changed.
 */
export const toEntries = (
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	lookups: Lookups,
	previous: ReadonlyArray<Entry>,
	firstNewId: MessageId | null,
): ReadonlyArray<Entry> => {
	const previousRows = new Map<string, RowEntry>()
	const previousOther = new Map<string, Entry>()
	for (const entry of previous)
		if (entry._tag === "Row") previousRows.set(entry.key, entry)
		else previousOther.set(entry.key, entry)
	const entering = enteringOf(messagesNewestFirst, previousRows)
	const entries: Array<Entry> = []
	let lastDate = ""
	for (let index = messagesNewestFirst.length - 1; index >= 0; index--) {
		const message = messagesNewestFirst[index]
		if (message === undefined) continue
		const before = messagesNewestFirst[index + 1]
		const grouped =
			before !== undefined &&
			message.id !== firstNewId &&
			message.authorId === before.authorId &&
			message.createdAtMs - before.createdAtMs <= GROUP_THRESHOLD_MS &&
			before.replyToMessageId === null
		const date = dateLabel(message.createdAtMs)
		if (date !== lastDate) {
			const key = `date:${date}`
			entries.push(previousOther.get(key) ?? { _tag: "Date", key, label: date })
			lastDate = date
		}
		if (message.id === firstNewId)
			entries.push(previousOther.get("unread") ?? { _tag: "Unread", key: "unread" })
		const old = previousRows.get(message.id)
		const next: RowEntry = {
			_tag: "Row",
			key: message.id,
			authorId: message.authorId,
			threadChannelId: message.threadChannelId,
			isPinned: message.isPinned,
			isOwn: message.authorId === lookups.currentUserId,
			grouped,
			entering: old?.entering ?? entering.has(message.id),
			row: messageRow(message, grouped, lookups),
		}
		entries.push(
			old === undefined
				? next
				: isSameRow(old, next)
					? old
					: sameJson(old.row, next.row)
						? { ...next, row: old.row }
						: next,
		)
	}
	return entries
}

/** The oldest loaded message newer than the read position and not the user's own. */
export const firstNewIdOf = (
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	sinceMs: number | null,
	userId: UserId,
): MessageId | null => {
	if (sinceMs === null) return null
	let found: MessageId | null = null
	for (const message of messagesNewestFirst)
		if (message.createdAtMs > sinceMs && message.authorId !== userId) found = message.id
	return found
}

/** How many loaded messages are new since the read position, and whether older ones may be too. */
export const newCountOf = (
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	sinceMs: number | null,
	userId: UserId,
	hasOlder: boolean,
): { readonly count: number; readonly isAtLeast: boolean } | null => {
	if (sinceMs === null) return null
	const count = messagesNewestFirst.filter(
		(message) => message.createdAtMs > sinceMs && message.authorId !== userId,
	).length
	if (count === 0) return null
	const oldest = messagesNewestFirst.at(-1)
	return { count, isAtLeast: hasOlder && oldest !== undefined && oldest.createdAtMs > sinceMs }
}
