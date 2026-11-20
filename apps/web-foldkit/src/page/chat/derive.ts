import { Schema, Struct } from "effect"
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import {
	extractGiphyMediaUrl,
	extractTweetId,
	extractYoutubeTimestamp,
	extractYoutubeVideoId,
	isKlipyUrl,
} from "~/components/link-preview.utils"
import {
	type FrameSurface,
	frameHeightOf,
	frameKey,
	type Model as HtmlRenderModel,
	renderKey,
} from "../../chat/html-render"
import { cachedLiveState, initialLiveState, liveEmbedOf, type LiveStates } from "../../chat/live-state"
import { processMessageUrls } from "../../chat/message/content"
import type { CustomerAuthorInfo } from "../../customers/chat-authors"
import type { LikeRow } from "../../mount/message-list"
import { linkPreviewKey, tweetKey, type Unfurls } from "../../chat/unfurl"
import {
	type AttachmentInfo,
	byKey,
	type Lookups,
	type PresenceInfo,
	shadowProviderOf,
	type SyncProvider,
	type UserInfo,
} from "./lookups"
import {
	type AggregatedReaction,
	type AuthorIdentity,
	type ChatMessage,
	type ChatReaction,
	type ReactionMotion,
	type DisplayRow,
	type GroupPosition,
	type HtmlRenderRow,
	type LiveRow,
	type MarkdownRefs,
	MessageRowData,
	type MessageRow,
	type ReplyPreview,
	type StatusEmoji,
	type ThreadPreview,
	type UrlEmbed,
} from "./rows"

/** Row derivation: grouping, date dividers and every lookup a message row displays. */

const GROUP_THRESHOLD_MS = 3 * 60 * 1000

/**
 * Both written the same way (by hand, or by the same agent): a change starts a new group, since
 * the "via <agent>" badge is in the group's header.
 */
const sameAttribution = (context: DeriveContext, a: { readonly id: string }, b: { readonly id: string }) =>
	context.agentNames.get(a.id) === context.agentNames.get(b.id)

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
	readonly syncedFrom: ReadonlyMap<string, SyncProvider>
	readonly agentNames: ReadonlyMap<string, string>
	/** Authors' sides by user id while the channel is linked to a customer; null when it is not. */
	readonly customerAuthors: ReadonlyMap<string, CustomerAuthorInfo> | null
	readonly threadNames: ReadonlyMap<string, string>
	readonly threadMessages: ReadonlyMap<string, ReadonlyArray<Lookups["threadMessages"][number]>>
	readonly replyTargets: ReadonlyMap<string, Lookups["replyTargets"][number]>
	readonly unfurls: Unfurls
	readonly liveStates: LiveStates
	readonly htmlRenders: HtmlRenderState
	readonly appearance: "light" | "dark"
}

/** The HTML render URLs and frames the rows read. */
export type HtmlRenderState = Pick<HtmlRenderModel, "urls" | "frames">

const NO_HTML_RENDER_STATE: HtmlRenderState = { urls: {}, frames: {} }

/** Fetched URL unfurls, streamed AI replies and HTML render frames, kept by the page beside the lookups. */
export interface EmbedState {
	readonly unfurls: Unfurls
	readonly liveStates: LiveStates
	readonly htmlRenders?: HtmlRenderState
	/** The app's appearance, the frames' color scheme. */
	readonly appearance?: "light" | "dark"
}

const NO_EMBED_STATE: EmbedState = { unfurls: {}, liveStates: {} }

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

export const toDeriveContext = (
	lookups: Lookups,
	currentUserId: string | undefined,
	embedState: EmbedState = NO_EMBED_STATE,
): DeriveContext => ({
	currentUserId,
	unfurls: embedState.unfurls,
	liveStates: embedState.liveStates,
	htmlRenders: embedState.htmlRenders ?? NO_HTML_RENDER_STATE,
	appearance: embedState.appearance ?? "dark",
	users: byKey(lookups.users, (user) => user.id),
	presence: byKey(lookups.presence, (presence) => presence.userId),
	botNames: new Map(lookups.bots.map((bot) => [bot.userId, bot.name])),
	emojiUrls: new Map(lookups.customEmojis.map((emoji) => [emoji.name, emoji.imageUrl])),
	attachmentsByMessage: groupBy(lookups.attachments, (attachment) => attachment.messageId),
	syncedFrom: new Map(lookups.syncedMessages.map((synced) => [synced.messageId, synced.provider])),
	agentNames: new Map(lookups.agentMarks.map((mark) => [mark.id, mark.agentName])),
	customerAuthors:
		lookups.customerAuthors === null ? null : byKey(lookups.customerAuthors, (author) => author.userId),
	threadNames: new Map(lookups.threadChannels.map((channel) => [channel.id, channel.name])),
	threadMessages: groupBy(lookups.threadMessages, (message) => message.channelId),
	replyTargets: byKey(lookups.replyTargets, (target) => target.id),
})

type AuthorUser = Pick<UserInfo, "firstName" | "lastName" | "avatarUrl" | "userType"> & {
	readonly email?: string | undefined
}

/** The message's author: the row's own join when its query has one, else the users lookup. */
export const authorOf = (context: DeriveContext, message: ChatMessage): AuthorUser | null => {
	const user = context.users.get(message.authorId)
	// The row's join carries no email; the lookup's tells a Slack or Discord person from an app.
	return message.author ? { ...message.author, email: user?.email } : (user ?? null)
}

/** `buildChatAuthorIdentity` with `useBotName`. */
export const authorIdentity = (
	user: AuthorUser | null | undefined,
	botName: string | undefined,
): AuthorIdentity => {
	if (!user) return { displayName: "", avatarUrl: null, isBot: false, syncProvider: null }
	const isMachine = user.userType === "machine"
	// Chat sync's shadow users are machine users too, but they are people on Slack or Discord.
	const syncProvider = isMachine ? shadowProviderOf(user.email) : null
	const isBot = isMachine && syncProvider === null
	const fallback = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
	return {
		displayName: isBot && botName ? botName : fallback,
		avatarUrl: user.avatarUrl,
		isBot,
		syncProvider,
	}
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
		motion: "none" as const,
	}))
}

/** More reactions than this changing at once are a sync catching up, not someone reacting. */
const MAX_LIVE_REACTION_CHANGES = 3

/** The reactions changed live (a few added or removed), so their pills animate the change. */
export const isLiveReactionChange = (
	previous: ReadonlyArray<ChatReaction>,
	next: ReadonlyArray<ChatReaction>,
): boolean => {
	const previousIds = new Set(previous.map((reaction) => reaction.id))
	const nextIds = new Set(next.map((reaction) => reaction.id))
	let changes = 0
	for (const id of nextIds) if (!previousIds.has(id) && ++changes > MAX_LIVE_REACTION_CHANGES) return false
	for (const id of previousIds) if (!nextIds.has(id) && ++changes > MAX_LIVE_REACTION_CHANGES) return false
	return true
}

/**
 * Each pill's `motion` against the row's previous pills: a live change sets it, anything else keeps
 * the previous one, and a row seen for the first time animates nothing.
 */
const withReactionMotion = (
	old: DisplayRow | undefined,
	reactions: ReadonlyArray<AggregatedReaction>,
	isLive: boolean,
): ReadonlyArray<AggregatedReaction> => {
	if (old === undefined || old._tag !== "MessageRow" || reactions.length === 0) return reactions
	const before = new Map(old.reactions.map((reaction) => [reaction.emoji, reaction]))
	return reactions.map((reaction) => {
		const previous = before.get(reaction.emoji)
		const motion: ReactionMotion =
			previous === undefined
				? isLive
					? "enter"
					: "none"
				: !isLive || reaction.count === previous.count
					? previous.motion
					: reaction.count > previous.count
						? "up"
						: "down"
		return motion === reaction.motion ? reaction : { ...reaction, motion }
	})
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
	if (target === undefined)
		return { messageId: replyToMessageId, authorId: null, author: null, firstLine: "" }
	return {
		messageId: replyToMessageId,
		authorId: target.authorId,
		author: identityOf(context, target.authorId),
		firstLine: target.content.split("\n")[0] ?? "",
	}
}

const threadOf = (context: DeriveContext, threadChannelId: ChannelId | null): ThreadPreview | null => {
	if (threadChannelId === null) return null
	const messages = context.threadMessages.get(threadChannelId) ?? []
	const last = messages[0]
	// An empty thread (or one whose messages have not synced yet) gets no card; "Reply in thread"
	// still opens it, since its id is derived from the message.
	if (last === undefined) return null
	return {
		threadChannelId,
		name: context.threadNames.get(threadChannelId) || "Thread",
		count: messages.length,
		lastMessage: {
			author: identityOf(context, last.authorId),
			text: plainLineOf(context, last.content),
			createdAtMs: last.createdAtMs,
		},
	}
}

const MENTION_PATTERN = /@\[userId:([^\]]+)\]/g
const EMOJI_PATTERN = /!\[custom-emoji:([^\]]+)\]/g

const MARKDOWN_MARKS = /[*_`~#>|]/g
const EMOJI_MARKUP = /!\[custom-emoji:([^\]]+)\]\([^)]*\)/g

/** A thread card's last message: its first non-empty line, mentions named and markdown marks dropped. */
const plainLineOf = (context: DeriveContext, content: string): string =>
	content
		.replace(MENTION_PATTERN, (_, userId: string) => {
			const user = context.users.get(userId)
			return `@${context.botNames.get(userId) ?? (user ? `${user.firstName} ${user.lastName}` : "unknown")}`
		})
		.replace(EMOJI_MARKUP, ":$1:")
		.replace(MARKDOWN_MARKS, "")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0) ?? ""

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

/** `Embeds`: tweets, YouTube, GIFs, then the last other URL as a link preview (Linear and GitHub need the HTTP API). */
const urlEmbedsOf = (context: DeriveContext, message: ChatMessage): ReadonlyArray<UrlEmbed> => {
	const urls = processMessageUrls(message)
	if (urls.embedUrls.length === 0 && urls.otherUrls.length === 0) return NO_URL_EMBEDS
	const embeds: UrlEmbed[] = []
	for (const url of urls.tweetUrls) {
		const tweetId = extractTweetId(url)
		if (tweetId)
			embeds.push({ _tag: "Tweet", url, tweetId, unfurl: context.unfurls[tweetKey(tweetId)] ?? null })
	}
	for (const url of urls.youtubeUrls) {
		const videoId = extractYoutubeVideoId(url)
		if (!videoId) continue
		const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`)
		const startTime = extractYoutubeTimestamp(url)
		if (startTime) embedUrl.searchParams.set("start", startTime.toString())
		embeds.push({ _tag: "Youtube", url, embedUrl: embedUrl.toString() })
	}
	for (const url of urls.gifUrls) {
		const isKlipy = isKlipyUrl(url)
		embeds.push({ _tag: "Gif", url, mediaUrl: isKlipy ? url : extractGiphyMediaUrl(url), isKlipy })
	}
	const previewUrl = urls.otherUrls[urls.otherUrls.length - 1]
	if (previewUrl)
		embeds.push({
			_tag: "LinkPreview",
			url: previewUrl,
			unfurl: context.unfurls[linkPreviewKey(previewUrl)] ?? null,
		})
	return embeds
}

export interface UnfurlRequest {
	readonly key: string
	readonly kind: "tweet" | "preview"
	/** The tweet id, or the URL to preview. */
	readonly value: string
}

/** The unfurls a message's embeds fetch (`TweetEmbed`, `LinkPreview`). */
export const unfurlRequestsOf = (message: ChatMessage): ReadonlyArray<UnfurlRequest> => {
	const urls = processMessageUrls(message)
	const requests: UnfurlRequest[] = []
	for (const url of urls.tweetUrls) {
		const tweetId = extractTweetId(url)
		if (tweetId) requests.push({ key: tweetKey(tweetId), kind: "tweet", value: tweetId })
	}
	const previewUrl = urls.otherUrls[urls.otherUrls.length - 1]
	if (previewUrl) requests.push({ key: linkPreviewKey(previewUrl), kind: "preview", value: previewUrl })
	return requests
}

/** `MessageEmbeds`' live-state block: the cached snapshot, or the connection's state. */
const liveOf = (context: DeriveContext, message: ChatMessage): LiveRow | null => {
	const live = liveEmbedOf(message.embeds)
	if (live === null) return null
	return {
		state: cachedLiveState(message.embeds) ?? context.liveStates[message.id] ?? initialLiveState,
		loading: { text: live.loading?.text ?? "Thinking", icon: live.loading?.icon ?? "sparkle" },
	}
}

/** The frames of the message's HTML render embeds on one surface, in embed order. */
export const htmlRendersOf = (
	context: DeriveContext,
	message: ChatMessage,
	surface: FrameSurface,
): ReadonlyArray<HtmlRenderRow> => {
	const rows: HtmlRenderRow[] = []
	for (const embed of message.embeds ?? []) {
		if (embed.html === undefined) continue
		const ref = { messageId: message.id, renderId: embed.html.renderId }
		const url = context.htmlRenders.urls[renderKey(ref)]
		const state = context.htmlRenders.frames[frameKey(surface, ref)]
		const height = frameHeightOf(embed.html.height, state)
		rows.push({
			renderId: embed.html.renderId,
			status: url?._tag ?? "Loading",
			src: url?._tag === "Ready" ? (state?.src ?? null) : null,
			fittedHeight: height.fitted,
			shownHeight: height.shown,
			isTall: height.isTall,
			isExpanded: state?.isExpanded ?? false,
			isLoaded: state?.isLoaded ?? false,
			appearance: context.appearance,
		})
	}
	return rows.length === 0 ? NO_HTML_RENDERS : rows
}

/** A linked channel's author the org has not classified yet. */
const UNKNOWN_SIDE: MessageRowData["authorSide"] = { side: "unknown", reason: "unknown" }

const authorSideOf = (context: DeriveContext, authorId: string): MessageRowData["authorSide"] => {
	if (context.customerAuthors === null) return null
	const author = context.customerAuthors.get(authorId)
	return author === undefined ? UNKNOWN_SIDE : { side: author.side, reason: author.reason }
}

const NO_HTML_RENDERS: ReadonlyArray<HtmlRenderRow> = []
const NO_URL_EMBEDS: ReadonlyArray<UrlEmbed> = []
const NO_REACTIONS: ReadonlyArray<ChatReaction> = []
const NO_ATTACHMENTS: ReadonlyArray<AttachmentInfo> = []

/** One message row's data; `undefined` fields never appear (Schema structs compare by keys). */
export const messageRowData = (
	message: ChatMessage,
	groupPosition: GroupPosition,
	reactions: ReadonlyArray<ChatReaction>,
	context: DeriveContext,
): MessageRowData => {
	const user = authorOf(context, message)
	return {
		key: message.id,
		message,
		groupPosition,
		reactions: aggregateReactions(reactions, context),
		author: authorIdentity(user, context.botNames.get(message.authorId)),
		hasAuthor: user !== null,
		status: statusOf(context, message.authorId),
		syncedFrom: context.syncedFrom.get(message.id) ?? null,
		agentName: context.agentNames.get(message.id) ?? null,
		authorSide: authorSideOf(context, message.authorId),
		reply: replyOf(context, message.replyToMessageId),
		thread: threadOf(context, message.threadChannelId),
		attachments: context.attachmentsByMessage.get(message.id) ?? NO_ATTACHMENTS,
		refs: refsOf(context, message.content),
		urlEmbeds: urlEmbedsOf(context, message),
		live: liveOf(context, message),
		htmlRenders: htmlRendersOf(context, message, "list"),
		isEntering: false,
	}
}

/** More new messages than this at once are a catch-up (a reconnect, the sync after the cache), not live. */
const MAX_ENTERING = 3

/**
 * The messages that just arrived live, as Slack and Discord animate them: new since `previousRows`,
 * which already showed messages, and newer than all of them, so a first load or an older page has
 * none. A batch past `MAX_ENTERING` animates nothing.
 */
const enteringIdsOf = (
	messages: ReadonlyArray<ChatMessage>,
	previousRows: ReadonlyArray<DisplayRow>,
	previousByKey: ReadonlyMap<string, DisplayRow>,
): ReadonlySet<MessageId> => {
	let newestMs = Number.NEGATIVE_INFINITY
	for (const row of previousRows)
		if (row._tag === "MessageRow" && row.message.createdAtMs > newestMs)
			newestMs = row.message.createdAtMs
	if (newestMs === Number.NEGATIVE_INFINITY) return NO_ENTERING
	const entering = new Set<MessageId>()
	for (const message of messages) {
		if (previousByKey.has(message.id) || message.createdAtMs <= newestMs) continue
		if (entering.size === MAX_ENTERING) return NO_ENTERING
		entering.add(message.id)
	}
	return entering
}

const NO_ENTERING: ReadonlySet<MessageId> = new Set()

/** A row keeps its entrance flag for as long as it is listed, so a re-derive never restarts it. */
const isEnteringRow = (
	old: DisplayRow | undefined,
	messageId: MessageId,
	entering: ReadonlySet<MessageId>,
): boolean => (old !== undefined && old._tag === "MessageRow" ? old.isEntering : entering.has(messageId))

/**
 * Oldest-first rows with a date header before each day; `messagesNewestFirst` is the query order.
 * Rows are plain literals: the tagged-union constructors validate, which costs ms per 10k rows.
 */
export const toDisplayRows = (
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	reactions: ReadonlyArray<ChatReaction>,
	context: DeriveContext,
	previousRows: ReadonlyArray<DisplayRow>,
	/** The reactions just changed live (`isLiveReactionChange`): their pills animate. */
	isLiveReactions = false,
): ReadonlyArray<DisplayRow> => {
	const previousByKey = new Map(previousRows.map((row) => [row.key, row]))
	const entering = enteringIdsOf(messagesNewestFirst, previousRows, previousByKey)
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
			previous.replyToMessageId !== null ||
			!sameAttribution(context, message, previous)
		const isGroupEnd =
			next === null ||
			message.authorId !== next.authorId ||
			next.createdAtMs - message.createdAtMs > GROUP_THRESHOLD_MS ||
			!sameAttribution(context, message, next)

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

		const old = previousByKey.get(message.id)
		const data = messageRowData(
			message,
			toGroupPosition(isGroupStart, isGroupEnd),
			reactionsByMessage.get(message.id) ?? NO_REACTIONS,
			context,
		)
		rows.push(
			sharedRow(old, {
				...data,
				reactions: withReactionMotion(old, data.reactions, isLiveReactions),
				isEntering: isEnteringRow(old, message.id, entering),
			}),
		)
	}
	return rows
}

/** Row data equality past the message, which callers compare by reference first. */
const isSameRowData = Schema.toEquivalence(Schema.Struct(Struct.omit(MessageRowData.fields, ["message"])))

/** The previous row when nothing it shows changed, so its memo hits; else a new row. */
const sharedRow = (old: DisplayRow | undefined, data: MessageRowData): MessageRow =>
	old !== undefined && old._tag === "MessageRow" && old.message === data.message && isSameRowData(old, data)
		? old
		: { _tag: "MessageRow", ...data }

/** `ThreadMessageListContent`'s grouping (oldest first). */
const threadGroupPositionAt = (
	messages: ReadonlyArray<ChatMessage>,
	index: number,
	context: DeriveContext,
): GroupPosition => {
	const message = messages[index]!
	const previous = index > 0 ? messages[index - 1]! : null
	const next = index < messages.length - 1 ? messages[index + 1]! : null
	const isStart =
		previous === null ||
		message.authorId !== previous.authorId ||
		message.createdAtMs - previous.createdAtMs > GROUP_THRESHOLD_MS ||
		previous.replyToMessageId !== null ||
		!sameAttribution(context, message, previous)
	const isEnd =
		next === null ||
		message.authorId !== next.authorId ||
		next.createdAtMs - message.createdAtMs > GROUP_THRESHOLD_MS ||
		!sameAttribution(context, message, next)
	return toGroupPosition(isStart, isEnd)
}

/**
 * The thread panel's rows (oldest first, no nested threads), sharing every unchanged row with
 * `previousRows`; the same array comes back when no row changed.
 */
export const toThreadRows = (
	messagesOldestFirst: ReadonlyArray<ChatMessage>,
	reactions: ReadonlyArray<ChatReaction>,
	context: DeriveContext,
	previousRows: ReadonlyArray<MessageRow>,
	isLiveReactions = false,
): ReadonlyArray<MessageRow> => {
	const previousByKey = new Map<string, DisplayRow>(previousRows.map((row) => [row.key, row]))
	const entering = enteringIdsOf(messagesOldestFirst, previousRows, previousByKey)
	const reactionsByMessage = groupBy(reactions, (reaction) => reaction.messageId)
	const rows = messagesOldestFirst.map((message, index) => {
		const old = previousByKey.get(message.id)
		const data = messageRowData(
			message,
			threadGroupPositionAt(messagesOldestFirst, index, context),
			reactionsByMessage.get(message.id) ?? NO_REACTIONS,
			context,
		)
		return sharedRow(old, {
			...data,
			reactions: withReactionMotion(old, data.reactions, isLiveReactions),
			thread: null,
			isEntering: isEnteringRow(old, message.id, entering),
		})
	})
	return rows.length === previousRows.length && rows.every((row, index) => row === previousRows[index])
		? previousRows
		: rows
}

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

/** `mt-2` above a group's first row and `mb-2` below its last (`messageRowView`). */
const GROUP_MARGIN_PX = 8

/** `py-1` on a message row. */
const ROW_PADDING_PX = 8

/** Starts a markdown block that draws taller than a line: a heading, quote, list or code. */
const BLOCK_START = /^\s*([#>*+-]|\d+\.)|`/

/** The margins a row's place in its group gives it: `mt-2` on a group's first, `mb-2` on its last. */
const marginsOf = (position: GroupPosition) =>
	(Number(startsGroup(position)) + Number(endsGroup(position))) * GROUP_MARGIN_PX

/**
 * The kind of row a message row is when nothing but a short line of text is in it: one with the
 * author header (a group's first) or without. Two rows of a kind differ only by their margins.
 * Null for anything that could wrap or draw taller.
 */
const plainKindOf = (row: MessageRow): string | null => {
	const { message } = row
	const content = message.content
	const isPlain =
		row.reply === null &&
		row.thread === null &&
		row.live === null &&
		row.attachments.length === 0 &&
		row.urlEmbeds.length === 0 &&
		row.reactions.length === 0 &&
		row.htmlRenders.length === 0 &&
		!message.hasEmbeds &&
		!message.isPinned &&
		content.length > 0 &&
		content.length <= 40 &&
		!content.includes("\n") &&
		// Emoji-only messages draw large.
		/[\p{L}\p{N}]/u.test(content) &&
		!BLOCK_START.test(content)
	if (!isPlain) return null
	return startsGroup(row.groupPosition) ? `header|${row.hasAuthor}` : "line"
}

/**
 * For each row not measured yet, the nearest older measured row of its kind (a one-line message,
 * a date divider) and the margins they differ by, so a message just sent or received, or the day's
 * first divider, is laid out at its real height before it is measured. Returns `previous` while
 * nothing changed.
 */
export const likeRowsOf = (
	rows: ReadonlyArray<DisplayRow>,
	measuredHeights: Readonly<Record<string, number>>,
	previous: Readonly<Record<string, LikeRow>>,
): Readonly<Record<string, LikeRow>> => {
	const lastByKind = new Map<string, { key: string; margins: number }>()
	const likeRows: Record<string, LikeRow> = {}
	let count = 0
	for (const row of rows) {
		const kind = row._tag === "DateHeader" ? "date-header" : plainKindOf(row)
		if (kind === null) continue
		const margins = row._tag === "DateHeader" ? 0 : marginsOf(row.groupPosition)
		const measured = measuredHeights[row.key]
		if (measured !== undefined) {
			lastByKind.set(kind, { key: row.key, margins })
			continue
		}
		const like = lastByKind.get(kind)
		if (like !== undefined) {
			likeRows[row.key] = { key: like.key, deltaPx: margins - like.margins }
			count++
			continue
		}
		// The group's first line-only row: the header is one line of the same text, so a row with
		// it is the padding and two lines, this one the padding and one.
		const headed = kind === "line" ? lastByKind.get("header|true") : undefined
		const headedHeight = headed === undefined ? undefined : measuredHeights[headed.key]
		if (headed !== undefined && headedHeight !== undefined) {
			const lineHeight = (headedHeight - headed.margins - ROW_PADDING_PX) / 2
			likeRows[row.key] = {
				key: headed.key,
				deltaPx: ROW_PADDING_PX + lineHeight + margins - headedHeight,
			}
			count++
		}
	}
	const previousKeys = Object.keys(previous)
	return previousKeys.length === count &&
		previousKeys.every(
			(key) =>
				previous[key]!.key === likeRows[key]?.key &&
				previous[key]!.deltaPx === likeRows[key]?.deltaPx,
		)
		? previous
		: likeRows
}

const endsGroup = (position: GroupPosition) => position === "end" || position === "standalone"
const startsGroup = (position: GroupPosition) => position === "start" || position === "standalone"

/**
 * Rows that gained or lost their bottom margin with this change (a message joined the group of the
 * row above it, or the row after it went away), by how much their measured height moved.
 */
export const marginShiftsOf = (
	previousRows: ReadonlyArray<DisplayRow>,
	rows: ReadonlyArray<DisplayRow>,
): ReadonlyArray<{ readonly key: string; readonly deltaPx: number }> => {
	if (previousRows.length === 0) return []
	const previousByKey = new Map(previousRows.map((row) => [row.key, row]))
	const shifts: Array<{ key: string; deltaPx: number }> = []
	for (const row of rows) {
		const old = previousByKey.get(row.key)
		if (row._tag !== "MessageRow" || old === undefined || old._tag !== "MessageRow") continue
		const before = old.groupPosition
		const after = row.groupPosition
		// A row that starts or stops starting a group also gains or loses its header: left to measure.
		if (before === after || startsGroup(before) !== startsGroup(after)) continue
		shifts.push({
			key: row.key,
			deltaPx: (Number(endsGroup(after)) - Number(endsGroup(before))) * GROUP_MARGIN_PX,
		})
	}
	return shifts
}
