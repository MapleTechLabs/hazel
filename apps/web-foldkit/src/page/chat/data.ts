import type { ChannelId, MessageId } from "@hazel/schema"
import { BasicIndex, coalesce, eq } from "@tanstack/db"
import { DateTime, Effect, PubSub, Stream } from "effect"
import {
	channelCollection,
	messageCollection,
	messageReactionCollection,
	pinnedMessageCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { type LiveQueryWindow, liveQueryChangeSetStream } from "../../data/live-query-changes"
import { MessageWindows } from "../../data/message-windows"
import {
	type ChannelInfo,
	type ChannelQueryRow,
	type MessageQueryRow,
	PAGE_SIZE,
	type ParentChannelInfo,
	type ReactionQueryRow,
	toChatMessage,
	toChatReaction,
} from "./queries"
import type { ChatMessage, ChatReaction } from "./rows"

/**
 * Data bridge for the channel page (S2 option a): the legacy collections and the exact query
 * builders of `routes/_app/$orgSlug/chat/$id.tsx` behind `liveQueryStream`.
 */

/** Messages by channel, so a channel's share of the loaded messages is a lookup, not a scan. */
const messagesByChannel = messageCollection.createIndex((row) => row.channelId, {
	indexType: BasicIndex,
	name: "messagesByChannel",
})

/**
 * Whether the window loads the whole channel and orders it in the query. TanStack fills an ordered
 * window by walking the `createdAt` index from the newest message of any channel, so a quiet
 * channel next to a busy one walks all of the busy one's newer rows (24 ms in the heavy fixture).
 * An expression as the order key (not a plain column) skips that walk; a busy channel keeps it.
 */
const loadsWholeChannel = (channelId: ChannelId) =>
	messagesByChannel.equalityLookup(channelId).size * 5 <= messageCollection.size

/**
 * The collections the message queries read. Only the channel's own (on-demand) collections: an
 * eager one, such as the org's `users`, would hold the query until every org had its snapshot.
 */
export interface MessageSources {
	readonly messages: typeof messageCollection
	readonly pinned: typeof pinnedMessageCollection
	readonly loadsWholeChannel: (channelId: ChannelId) => boolean
}

const appMessageSources: MessageSources = {
	messages: messageCollection,
	pinned: pinnedMessageCollection,
	loadsWholeChannel,
}

/**
 * The channel's messages, newest first, as change sets: `offset` newest messages skipped, `limit` kept.
 * One query per channel follows the pages `MessageWindows` publishes; only changed rows are converted.
 */
export const messageChangesStream = <Message>(
	channelId: ChannelId,
	window: LiveQueryWindow,
	readWindow: () => LiveQueryWindow,
	toMessage: (changes: { order: ReadonlyArray<MessageId>; upserts: ReadonlyArray<ChatMessage> }) => Message,
): Stream.Stream<Message, never, MessageWindows> =>
	Stream.unwrap(
		Effect.gen(function* () {
			// Subscribed before the query starts, so no page published from here on is missed.
			const pages = yield* PubSub.subscribe(yield* MessageWindows)
			const windows = Stream.fromSubscription(pages).pipe(
				Stream.filter((change) => change.channelId === channelId),
				Stream.map(({ offset, limit }) => ({ offset, limit })),
			)
			return messageQueryStream(appMessageSources, channelId, window, readWindow, windows, toMessage)
		}),
	)

/** `messageChangesStream` over `sources`, following `windows`. */
export const messageQueryStream = <Message>(
	sources: MessageSources,
	channelId: ChannelId,
	window: LiveQueryWindow,
	readWindow: () => LiveQueryWindow,
	windows: Stream.Stream<LiveQueryWindow>,
	toMessage: (changes: { order: ReadonlyArray<MessageId>; upserts: ReadonlyArray<ChatMessage> }) => Message,
): Stream.Stream<Message> =>
	liveQueryChangeSetStream<MessageQueryRow, Message, MessageId>(
		(q, { limit, offset }) => {
			const isWholeChannel = sources.loadsWholeChannel(channelId)
			return (
				q
					.from({ message: sources.messages })
					.leftJoin({ pinned: sources.pinned }, ({ message, pinned }) =>
						eq(message.id, pinned.messageId),
					)
					// Authors come from the users lookup (`derive.ts` `authorOf`), not a join: see `MessageSources`.
					.where(({ message }) => eq(message.channelId, channelId))
					.select(({ message, pinned }) => ({ ...message, pinnedMessage: pinned }))
					.orderBy(
						({ message }) => (isWholeChannel ? coalesce(message.createdAt) : message.createdAt),
						"desc",
					)
					.limit(limit)
					.offset(offset)
			)
		},
		window,
		readWindow,
		windows,
		(row) => row.id,
		({ order, upserts }) => toMessage({ order, upserts: upserts.map(toChatMessage) }),
	)

/**
 * Keeps the channel's history loaded a page past the window while the stream runs: a window that
 * reaches past what the `ChannelObject` snapshot sent (its newest messages) pages older ones in, so
 * scrolling back grows the window as before. A reset re-requests them.
 */
export const messageHistoryStream = (channelId: ChannelId, window: LiveQueryWindow): Stream.Stream<never> =>
	historyDemandStream(channelId, window.offset + window.limit + PAGE_SIZE)

/** Holds `count` of the channel's newest messages loaded (paging older ones in) while it runs. */
const historyDemandStream = (channelId: ChannelId, count: number): Stream.Stream<never> =>
	Stream.callback<never>(() =>
		Effect.acquireRelease(
			Effect.sync(() => messageCollection.utils.retainHistory(channelId, count)),
			(demand) => Effect.sync(() => demand.release()),
		).pipe(Effect.flatMap(() => Effect.never)),
	)

const msOf = (value: Date | DateTime.Utc) =>
	value instanceof Date ? value.getTime() : DateTime.toEpochMillis(value)

/** The most `LoadOlder` asks for at once, and how many of them a locate makes before giving up. */
const LOCATE_PAGE_SIZE = 200
const LOCATE_MAX_PAGES = 50

/**
 * How many of the channel's messages are newer than `messageId`, once the history is held back to
 * it: a reply target loaded by id sits alone, older than the held history, so pages are loaded until
 * they reach it. Null when the message is not held, or the history cannot be paged that far now.
 */
export const locateMessage = (channelId: ChannelId, messageId: MessageId): Effect.Effect<number | null> =>
	Effect.gen(function* () {
		for (let page = 0; page <= LOCATE_MAX_PAGES; page++) {
			const target = messageCollection.get(messageId)
			if (target === undefined || target.channelId !== channelId) return null
			const createdAtMs = msOf(target.createdAt)
			let newerCount = 0
			for (const key of messagesByChannel.equalityLookup(channelId)) {
				const row = messageCollection.get(key)
				if (row !== undefined && msOf(row.createdAt) > createdAtMs) newerCount++
			}
			const history = messageCollection.utils.historyOf(channelId)
			// Held from the newest message down past the target, or there is nothing older to load.
			if (history === undefined || history.loaded > newerCount || !history.hasMore) return newerCount
			yield* Effect.tryPromise(() =>
				messageCollection.utils.loadOlder(channelId, LOCATE_PAGE_SIZE),
			).pipe(Effect.orElseSucceed(() => false))
			// No page came (offline, rate limited): asking again at once would only spin.
			const loaded = messageCollection.utils.historyOf(channelId)?.loaded ?? 0
			if (loaded <= history.loaded) return null
		}
		return null
	})

export const reactionsStream = <Message>(
	channelId: ChannelId,
	toMessage: (reactions: ReadonlyArray<ChatReaction>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ReactionQueryRow, Message>(
		(q) =>
			q
				.from({ reactions: messageReactionCollection })
				.where(({ reactions }) => eq(reactions.channelId, channelId)),
		(rows) => toMessage(rows.map(toChatReaction)),
	)

export const channelStream = <Message>(
	channelId: ChannelId,
	toMessage: (channel: ChannelInfo | null) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ChannelQueryRow, Message>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, channelId))
				.findOne(),
		(rows) => {
			const row = rows[0]
			return toMessage(
				row
					? {
							id: row.id,
							name: row.name,
							type: row.type,
							icon: row.icon ?? null,
							organizationId: row.organizationId,
							parentChannelId: row.parentChannelId ?? null,
						}
					: null,
			)
		},
	)

/** `useParentChannel`: the thread's parent for the header breadcrumb. */
export const parentChannelStream = <Message>(
	parentChannelId: ChannelId,
	toMessage: (channel: ParentChannelInfo | null) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ChannelQueryRow, Message>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where((t) => eq(t.channel.id, parentChannelId))
				.findOne(),
		(rows) => {
			const row = rows[0]
			return toMessage(row ? { id: row.id, name: row.name, icon: row.icon ?? null } : null)
		},
	)

/**
 * `threadMessagesWithAuthorAtomFamily`: the open thread panel's messages, oldest first. The panel
 * shows the whole thread, so it holds the thread's whole history: the `ChannelObject` snapshot
 * sends only the newest messages, and the rest page in.
 */
export const threadPanelStream = <Message>(
	threadChannelId: ChannelId,
	toMessage: (messages: ReadonlyArray<ChatMessage>) => Message,
): Stream.Stream<Message> =>
	Stream.merge(
		threadPanelQueryStream(appMessageSources, threadChannelId, toMessage),
		threadHistoryStream(threadChannelId),
	)

/** The whole thread's history, held while the panel is open. */
export const threadHistoryStream = (threadChannelId: ChannelId): Stream.Stream<never> =>
	historyDemandStream(threadChannelId, Number.POSITIVE_INFINITY)

/** A thread's messages over `sources`, oldest first. */
export const threadPanelQueryStream = <Message>(
	sources: Pick<MessageSources, "messages">,
	threadChannelId: ChannelId,
	toMessage: (messages: ReadonlyArray<ChatMessage>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<MessageQueryRow, Message>(
		(q) =>
			q
				.from({ message: sources.messages })
				.where(({ message }) => eq(message.channelId, threadChannelId))
				.select(({ message }) => ({ ...message, pinnedMessage: null }))
				.orderBy(({ message }) => message.createdAt, "asc"),
		(rows) => toMessage(rows.map(toChatMessage)),
	)
