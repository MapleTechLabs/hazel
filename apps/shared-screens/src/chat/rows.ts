/**
 * The message list's entries from its data: today's grouping, date dividers and "New" line
 * (`web-foldkit/src/page/chat/derive.ts` `toDisplayRows`), each message shaped into the row data the
 * `message` primitive draws. Pure, so the grouping is tested without a host.
 */
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { BlockKind, RunKind } from "@hazel/ui/vocabulary/content"
import type { Content, MessageAction } from "@hazel/ui/vocabulary/index"
import { dateLabel, distanceStrict, formatBytes, formatTime, initialsOf } from "./format"
import type { HtmlRenderRef, PreviewRequest, RichParts } from "./rich/embeds"
import { isWaitingForContent, type LiveActorState, liveStateOf } from "./rich/live-replies"
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
	/** Its embeds and the links its text unfurls (`rich/embeds.ts`). */
	readonly rich: RichParts
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
	/** What each live reply's socket said so far, by message id. */
	readonly live: ReadonlyMap<string, LiveActorState>
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
	/** The links the view unfurls into cards before the row's own (query results). */
	readonly previews: ReadonlyArray<PreviewRequest>
	/** The HTML renders drawn under the row. */
	readonly renders: ReadonlyArray<HtmlRenderRef>
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

const filesOf = (lookups: Lookups, messageId: MessageId, pictures: ReadonlyArray<Content.Attachment>) => {
	const files = (lookups.attachments.get(messageId) ?? []).map((file): Content.Attachment => ({
		id: file.id,
		kind: IMAGE.test(file.fileName) ? "image" : VIDEO.test(file.fileName) ? "video" : "file",
		name: file.fileName,
		size: formatBytes(file.fileSize),
		url: file.url,
	}))
	// HAZEL-GAP(p4-embed-order): image-only embeds and GIFs show as pictures after the uploads; the renderer draws them before the cards.
	const all = [...files, ...pictures]
	return all.length === 0 ? undefined : all
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
export const actionsOf = (
	isOwn: boolean,
	isPinned: boolean,
	hasImage = false,
): ReadonlyArray<MessageAction> => [
	"react",
	"copy",
	...(isOwn ? (["edit"] as const) : []),
	"reply",
	"thread",
	isPinned ? "unpin" : "pin",
	"selectText",
	...(isOwn ? (["delete"] as const) : []),
	// The web's right-click menu: over an image it copies it or its address; always the id.
	...(hasImage ? (["copyImage", "copyImageUrl"] as const) : []),
	"copyId",
]

/** Structural equality over plain data (the lookups' records), `===` first. */
const same = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
	if (Array.isArray(a) || Array.isArray(b))
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => same(item, b[index]))
		)
	const left = Object.entries(a)
	const right = new Map<string, unknown>(Object.entries(b))
	return (
		left.length === right.size &&
		left.every(([key, value]) => right.has(key) && same(value, right.get(key)))
	)
}

type LookupName = keyof Lookups

/** One thing a row read from its lookups: a map's entry (`key`), or a whole field (`key` null, by `===`). */
interface Read {
	readonly name: LookupName
	readonly key: string | null
	readonly value: unknown
}

/** A map that notes every read into `reads`. */
class Recording<V> implements ReadonlyMap<string, V> {
	constructor(
		private readonly map: ReadonlyMap<string, V>,
		private readonly name: LookupName,
		private readonly reads: Array<Read>,
	) {}
	get(key: string) {
		const value = this.map.get(key)
		this.reads.push({ name: this.name, key, value })
		return value
	}
	has(key: string) {
		return this.get(key) !== undefined
	}
	/** Anything past a keyed read depends on the whole map. */
	private all() {
		this.reads.push({ name: this.name, key: null, value: this.map })
		return this.map
	}
	get size() {
		return this.all().size
	}
	forEach(each: (value: V, key: string, map: ReadonlyMap<string, V>) => void) {
		this.all().forEach(each)
	}
	entries() {
		return this.all().entries()
	}
	keys() {
		return this.all().keys()
	}
	values() {
		return this.all().values()
	}
	[Symbol.iterator]() {
		return this.all()[Symbol.iterator]()
	}
}

/** `lookups`, noting every read into `reads`. */
const recording = (lookups: Lookups, reads: Array<Read>): Lookups => {
	const scalar = <K extends "currentUserId" | "nowMs">(name: K): Lookups[K] => {
		reads.push({ name, key: null, value: lookups[name] })
		return lookups[name]
	}
	return {
		get currentUserId() {
			return scalar("currentUserId")
		},
		get nowMs() {
			return scalar("nowMs")
		},
		users: new Recording(lookups.users, "users", reads),
		botNames: new Recording(lookups.botNames, "botNames", reads),
		groupHandles: new Recording(lookups.groupHandles, "groupHandles", reads),
		reactions: new Recording(lookups.reactions, "reactions", reads),
		attachments: new Recording(lookups.attachments, "attachments", reads),
		threads: new Recording(lookups.threads, "threads", reads),
		replyTargets: new Recording(lookups.replyTargets, "replyTargets", reads),
		emojiUrls: new Recording(lookups.emojiUrls, "emojiUrls", reads),
		live: new Recording(lookups.live, "live", reads),
	}
}

/** `lookups` still give what `read` saw (reading through `lookups`, so an outer recording notes it). */
const stillReads = (lookups: Lookups, read: Read) => {
	const field = lookups[read.name]
	if (read.key === null) return field === read.value
	return typeof field === "object" && same(field.get(read.key), read.value)
}

interface Memo<A> {
	readonly grouped: boolean
	readonly reads: ReadonlyArray<Read>
	value: A
}

/**
 * `compute`'s value for `message`, kept while everything it read from the lookups is unchanged: an
 * unrelated change (a reaction elsewhere, the clock, a stream chunk) reuses it, `===`.
 */
const remember = <A>(
	memos: WeakMap<ChatMessage, Memo<A>>,
	message: ChatMessage,
	grouped: boolean,
	lookups: Lookups,
	compute: (lookups: Lookups) => A,
): A => {
	const memo = memos.get(message)
	if (
		memo !== undefined &&
		memo.grouped === grouped &&
		memo.reads.every((read) => stillReads(lookups, read))
	)
		return memo.value
	const reads: Array<Read> = []
	const value = compute(recording(lookups, reads))
	memos.set(message, { grouped, reads, value })
	return value
}

const bodies = new WeakMap<ChatMessage, Memo<Content.MessageRow["body"]>>()
const rows = new WeakMap<ChatMessage, Memo<Content.MessageRow>>()
const dates = new WeakMap<ChatMessage, string>()

const dateOf = (message: ChatMessage) => {
	let date = dates.get(message)
	if (date === undefined) dates.set(message, (date = dateLabel(message.createdAtMs)))
	return date
}

/**
 * The body: the text without the URLs that embed, or a live reply's text so far (it stands in for
 * the content, as today); its loading line until the reply says anything, then its error. Parsed
 * once per message and the names it shows.
 */
const bodyOf = (message: ChatMessage, lookups: Lookups): Content.MessageRow["body"] =>
	remember(bodies, message, false, lookups, (tracked) => parseBody(message, tracked, namesOf(tracked)))

const parseBody = (message: ChatMessage, lookups: Lookups, names: Names): Content.MessageRow["body"] => {
	const live = message.rich.live
	if (live === null) return parseMarkdown(message.rich.displayContent, names)
	const state = liveStateOf(live.cached, lookups.live.get(message.id))
	// HAZEL-GAP(p4-message-live): today's loading line has a breathing sparkle and a shimmer, a progress bar runs while it works, the text streams with a blinking cursor and an error is a danger callout; the row's body carries text only.
	if (isWaitingForContent(state)) return [[BlockKind.paragraph, [[RunKind.emphasis, `${live.loading}...`]]]]
	const text = parseMarkdown(state.text, names)
	return state.status === "failed" && state.error !== null
		? [...text, [BlockKind.paragraph, [[RunKind.strong, "Something went wrong"], ` ${state.error}`]]]
		: text
}

/** A message's row data; the header fields are left out on a grouped row. */
export const messageRow = (message: ChatMessage, grouped: boolean, lookups: Lookups): Content.MessageRow => {
	const names = namesOf(lookups)
	const user = lookups.users.get(message.authorId)
	const author = displayNameOf(lookups, message.authorId)
	const isOwn = message.authorId === lookups.currentUserId
	const reply = replyOf(lookups, names, message.replyToMessageId)
	const files = filesOf(lookups, message.id, message.rich.images)
	const showHeader = !grouped || reply !== undefined
	return compact({
		author: showHeader ? author : undefined,
		initials: showHeader && author !== undefined ? initialsOf(author) : undefined,
		avatar: showHeader ? (user?.avatarUrl ?? undefined) : undefined,
		provider: showHeader && user !== undefined ? providerOf(user) : undefined,
		time: formatTime(message.createdAtMs),
		body: bodyOf(message, lookups),
		reactions: reactionsOf(lookups, message.id),
		quick: [...QUICK_EMOJIS],
		edited:
			message.updatedAtMs !== null && message.updatedAtMs - message.createdAtMs > 1000
				? true
				: undefined,
		reply,
		files,
		embeds: message.rich.cards.length === 0 ? undefined : message.rich.cards,
		thread: threadOf(lookups, names, message.threadChannelId),
		actions: actionsOf(isOwn, message.isPinned, files?.some((file) => file.kind === "image") === true),
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
	sameJson(a.row, b.row) &&
	sameJson(a.previews, b.previews) &&
	sameJson(a.renders, b.renders)

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
		const date = dateOf(message)
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
			row: remember(rows, message, grouped, lookups, (tracked) =>
				messageRow(message, grouped, tracked),
			),
			previews: message.rich.previews,
			renders: message.rich.renders,
		}
		const kept =
			old === undefined
				? next
				: isSameRow(old, next)
					? old
					: sameJson(old.row, next.row)
						? { ...next, row: old.row }
						: next
		// The memo holds the row the entry kept, so the next derive compares it by reference.
		const memo = rows.get(message)
		if (memo !== undefined) memo.value = kept.row
		entries.push(kept)
	}
	return entries
}

const withCards = new WeakMap<
	Content.MessageRow,
	{ readonly cards: ReadonlyArray<Content.Embed>; readonly row: Content.MessageRow }
>()

/**
 * The row with its unfurled links' cards before its own, as today's URL embeds come first. The
 * same object while the row and its cards are, so the renderer (which skips a `===` prop) leaves it.
 */
export const rowWithCards = (entry: RowEntry, cards: ReadonlyArray<Content.Embed>): Content.MessageRow => {
	if (cards.length === 0) return entry.row
	const cached = withCards.get(entry.row)
	if (cached !== undefined && same(cached.cards, cards)) return cached.row
	const row = { ...entry.row, embeds: [...cards, ...(entry.row.embeds ?? [])] }
	withCards.set(entry.row, { cards, row })
	return row
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
