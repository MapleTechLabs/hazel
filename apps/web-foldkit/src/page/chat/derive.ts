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
import { linkPreviewKey, tweetKey, type Unfurls } from "../../chat/unfurl"
import { type AttachmentInfo, byKey, type Lookups, type PresenceInfo, type UserInfo } from "./lookups"
import {
	type AggregatedReaction,
	type AuthorIdentity,
	type ChatMessage,
	type ChatReaction,
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
	urlEmbeds: urlEmbedsOf(context, message),
	live: liveOf(context, message),
	htmlRenders: htmlRendersOf(context, message, "list"),
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
		rows.push(sharedRow(previousByKey.get(message.id), data))
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
const threadGroupPositionAt = (messages: ReadonlyArray<ChatMessage>, index: number): GroupPosition => {
	const message = messages[index]!
	const previous = index > 0 ? messages[index - 1]! : null
	const next = index < messages.length - 1 ? messages[index + 1]! : null
	const isStart =
		previous === null ||
		message.authorId !== previous.authorId ||
		message.createdAtMs - previous.createdAtMs > GROUP_THRESHOLD_MS ||
		previous.replyToMessageId !== null
	const isEnd =
		next === null ||
		message.authorId !== next.authorId ||
		next.createdAtMs - message.createdAtMs > GROUP_THRESHOLD_MS
	return toGroupPosition(isStart, isEnd)
}

/**
 * The thread panel's rows (oldest first, no reactions or nested threads), sharing every unchanged
 * row with `previousRows`; the same array comes back when no row changed.
 */
export const toThreadRows = (
	messagesOldestFirst: ReadonlyArray<ChatMessage>,
	context: DeriveContext,
	previousRows: ReadonlyArray<MessageRow>,
): ReadonlyArray<MessageRow> => {
	const previousByKey = new Map(previousRows.map((row) => [row.key, row]))
	const rows = messagesOldestFirst.map((message, index) =>
		sharedRow(previousByKey.get(message.id), {
			...messageRowData(
				message,
				threadGroupPositionAt(messagesOldestFirst, index),
				NO_REACTIONS,
				context,
			),
			thread: null,
		}),
	)
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
