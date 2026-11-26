// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The message list's data over `@hazel/client-data` (the queries of today's channel page,
 * `web-foldkit/src/page/chat/{data,lookup-data}.ts`) and its Commands. One messages query per
 * channel follows a window (`MessageWindows`), so paging moves rows instead of rebuilding it.
 */
import { Command, Renderer } from "@effect/ui"
import { ClientData, HazelRpc, type LiveQueryWindow, liveQueryChangeSetStream } from "@hazel/client-data"
import { ChannelId, MessageId, PinnedMessageId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Schedule, Schema, Stream } from "effect"
import { HostRequest, MessageListMessage } from "./messages"
import type { ChatMessage } from "./rows"

/** Messages the list holds at first, and how many more each page adds. */
export const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// the window
// ---------------------------------------------------------------------------

/** Each channel's current window, and who follows it: one per mounted list. */
export class MessageWindows extends Context.Service<MessageWindows>()("hazel/chat/MessageWindows", {
	make: Effect.sync(() => {
		const windows = new Map<string, LiveQueryWindow>()
		const listeners = new Map<string, Set<(window: LiveQueryWindow) => void>>()
		const read = (channelId: string): LiveQueryWindow =>
			windows.get(channelId) ?? { offset: 0, limit: PAGE_SIZE }
		const set = (channelId: string, window: LiveQueryWindow) => {
			windows.set(channelId, window)
			for (const listener of listeners.get(channelId) ?? []) listener(window)
		}
		const changes = (channelId: string): Stream.Stream<LiveQueryWindow> =>
			Stream.callback<LiveQueryWindow>((queue) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						const listener = (window: LiveQueryWindow) => {
							Queue.offerUnsafe(queue, window)
						}
						let set = listeners.get(channelId)
						if (set === undefined) listeners.set(channelId, (set = new Set()))
						set.add(listener)
						return listener
					}),
					(listener) => Effect.sync(() => listeners.get(channelId)?.delete(listener)),
				).pipe(Effect.flatMap(() => Effect.never)),
			)
		return { read, set, changes }
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

/** Moves the channel's window to its newest `limit` messages. */
export class MoveWindow extends Command.Service<MoveWindow>()("hazel/chat/MoveWindow", {
	args: { channelId: ChannelId, limit: Schema.Finite },
	success: MessageListMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const windows = yield* MessageWindows
			return ({ channelId, limit }) =>
				Effect.sync(() => {
					windows.set(channelId, { offset: 0, limit })
					return MessageListMessage.CompletedCommand()
				})
		}),
	)
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

type Data = ClientData["Service"]

const withData = <A>(f: (data: Data) => Stream.Stream<A>) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			f,
		),
	)

const msOf = (value: Date | string | null | undefined) =>
	value === null || value === undefined ? null : new Date(value).getTime()

interface MessageRow {
	readonly id: MessageId
	readonly channelId: ChannelId
	readonly authorId: UserId
	readonly content: string
	readonly embeds?: ReadonlyArray<{
		readonly url?: string | undefined
		readonly title?: string | undefined
		readonly description?: string | undefined
		readonly author?: { readonly name?: string | undefined } | undefined
		readonly image?: { readonly url: string } | undefined
		readonly thumbnail?: { readonly url: string } | undefined
	}> | null
	readonly replyToMessageId?: MessageId | null
	readonly threadChannelId?: ChannelId | null
	readonly createdAt: Date
	readonly updatedAt?: Date | null
	readonly pinned?: { readonly id: string } | null
}

/** Bot and link cards that carry a url, as the `embed` card draws them. */
const embedsOf = (row: MessageRow) =>
	(row.embeds ?? []).flatMap((embed) =>
		embed.url === undefined
			? []
			: [
					Object.fromEntries(
						Object.entries({
							url: embed.url,
							title: embed.title,
							description: embed.description,
							site: embed.author?.name,
							image: embed.image?.url ?? embed.thumbnail?.url,
						}).filter(([, value]) => value !== undefined),
					) as { readonly url: string },
				],
	)

export const toChatMessage = (row: MessageRow): ChatMessage => ({
	id: row.id,
	channelId: row.channelId,
	authorId: row.authorId,
	content: row.content,
	createdAtMs: new Date(row.createdAt).getTime(),
	updatedAtMs: msOf(row.updatedAt),
	replyToMessageId: row.replyToMessageId ?? null,
	threadChannelId: row.threadChannelId ?? null,
	isPinned: row.pinned?.id !== undefined,
	pinnedId: row.pinned?.id ?? null,
	embeds: embedsOf(row),
})

/** The channel's messages newest first, following the window; change sets after the first. */
export const messagesStream = (channelId: ChannelId) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData.useSync((data) => data)
			const windows = yield* MessageWindows
			// A fresh mount starts at the first page again.
			windows.set(channelId, { offset: 0, limit: PAGE_SIZE })
			const { messageCollection, pinnedMessageCollection } = data.collections
			return liveQueryChangeSetStream<MessageRow, MessageListMessage, MessageId>(
				(q, { limit, offset }) =>
					q
						.from({ message: messageCollection })
						.leftJoin({ pinned: pinnedMessageCollection }, ({ message, pinned }) =>
							eq(message.id, pinned.messageId),
						)
						.where(({ message }) => eq(message.channelId, channelId))
						.select(({ message, pinned }) => ({ ...message, pinned }))
						.orderBy(({ message }) => message.createdAt, "desc")
						.limit(limit)
						.offset(offset),
				windows.read(channelId),
				() => windows.read(channelId),
				windows.changes(channelId),
				(row) => row.id,
				({ order, upserts }) =>
					MessageListMessage.UpdatedMessages({ order, upserts: upserts.map(toChatMessage) }),
			)
		}),
	)

/** Holds the newest `count` messages loaded (paging older ones in) and reports whether more exist. */
export const historyStream = (channelId: ChannelId, count: number) =>
	withData((data) =>
		Stream.unwrap(
			Effect.map(
				Effect.acquireRelease(
					Effect.sync(() =>
						data.collections.messageCollection.utils.retainHistory(channelId, count),
					),
					(demand) => Effect.sync(() => demand.release()),
				),
				() =>
					Stream.fromEffectSchedule(
						Effect.sync(
							() =>
								data.collections.messageCollection.utils.historyOf(channelId)?.hasMore ??
								true,
						),
						Schedule.spaced(Duration.millis(250)),
					).pipe(
						Stream.changes,
						Stream.map((hasMore) => MessageListMessage.UpdatedHistory({ hasMore })),
					),
			),
		),
	)

export const reactionsStream = (channelId: ChannelId) =>
	withData((data) =>
		data.liveQueryStream<{ messageId: MessageId; userId: UserId; emoji: string }, MessageListMessage>(
			(q) =>
				q
					.from({ reaction: data.collections.messageReactionCollection })
					.where(({ reaction }) => eq(reaction.channelId, channelId))
					.orderBy(({ reaction }) => reaction.createdAt, "asc"),
			(rows) =>
				MessageListMessage.UpdatedReactions({
					reactions: rows.map(({ messageId, userId, emoji }) => ({ messageId, userId, emoji })),
				}),
		),
	)

interface UserRow {
	readonly id: UserId
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl?: string | null
	readonly userType: string
	readonly email?: string | null
}

export const usersStream = withData((data) =>
	data.liveQueryStream<UserRow, MessageListMessage>(
		(q) => q.from({ user: data.collections.userCollection }),
		(rows) =>
			MessageListMessage.UpdatedUsers({
				users: rows.map((user) => ({
					id: user.id,
					firstName: user.firstName,
					lastName: user.lastName,
					avatarUrl: user.avatarUrl ?? null,
					userType: user.userType,
					email: user.email ?? null,
				})),
			}),
	),
)

export const botsStream = withData((data) =>
	data.liveQueryStream<{ userId: UserId; name: string }, MessageListMessage>(
		(q) =>
			q
				.from({ bot: data.collections.botCollection })
				.where(({ bot }) => isNull(bot.deletedAt))
				.select(({ bot }) => ({ userId: bot.userId, name: bot.name })),
		(rows) =>
			MessageListMessage.UpdatedBots({ bots: rows.map((row) => ({ id: row.userId, name: row.name })) }),
	),
)

/** An attachment's file: its own url, else the CDN's copy (today's `getAttachmentUrl`). */
export const attachmentsStream = (channelId: ChannelId, cdnUrl: string) =>
	withData((data) =>
		data.liveQueryStream<
			{
				id: string
				messageId?: MessageId | null
				fileName: string
				fileSize: number
				externalUrl?: string | null
			},
			MessageListMessage
		>(
			(q) =>
				q
					.from({ attachment: data.collections.attachmentCollection })
					.where(({ attachment }) => eq(attachment.channelId, channelId))
					.orderBy(({ attachment }) => attachment.uploadedAt, "asc"),
			(rows) =>
				MessageListMessage.UpdatedAttachments({
					attachments: rows.map((row) => ({
						id: row.id,
						messageId: row.messageId ?? null,
						fileName: row.fileName,
						fileSize: row.fileSize,
						url: row.externalUrl?.trim() || `${cdnUrl}/${row.id}`,
					})),
				}),
		),
	)

/** The thread cards' names. */
export const threadNamesStream = (threadIds: ReadonlyArray<ChannelId>) =>
	threadIds.length === 0
		? Stream.make(MessageListMessage.UpdatedThreadNames({ threads: [] }))
		: withData((data) =>
				data.liveQueryStream<{ id: ChannelId; name: string }, MessageListMessage>(
					(q) =>
						q
							.from({ channel: data.collections.channelCollection })
							.where(({ channel }) => inArray(channel.id, [...threadIds])),
					(rows) =>
						MessageListMessage.UpdatedThreadNames({
							threads: rows.map((row) => ({ id: row.id, name: row.name })),
						}),
				),
			)

/** The thread cards' messages: their count and newest message. */
export const threadMessagesStream = (threadIds: ReadonlyArray<ChannelId>) =>
	threadIds.length === 0
		? Stream.make(MessageListMessage.UpdatedThreadMessages({ messages: [] }))
		: withData((data) =>
				data.liveQueryStream<
					{ channelId: ChannelId; authorId: UserId; content: string; createdAt: Date },
					MessageListMessage
				>(
					(q) =>
						q
							.from({ message: data.collections.messageCollection })
							.where(({ message }) => inArray(message.channelId, [...threadIds]))
							.orderBy(({ message }) => message.createdAt, "desc"),
					(rows) =>
						MessageListMessage.UpdatedThreadMessages({
							messages: rows.map((row) => ({
								channelId: row.channelId,
								authorId: row.authorId,
								content: row.content,
								createdAtMs: new Date(row.createdAt).getTime(),
							})),
						}),
				),
			)

/** Replied-to messages, held loaded even when older than the window. */
export const replyTargetsStream = (channelId: ChannelId, ids: ReadonlyArray<MessageId>) =>
	ids.length === 0
		? Stream.make(MessageListMessage.UpdatedReplyTargets({ targets: [] }))
		: withData((data) =>
				Stream.unwrap(
					Effect.map(
						Effect.acquireRelease(
							Effect.sync(() =>
								data.collections.messageCollection.utils.loadByIds(channelId, ids),
							),
							(demand) => Effect.sync(() => demand.release()),
						),
						() =>
							data.liveQueryStream<
								{ id: MessageId; authorId: UserId; content: string },
								MessageListMessage
							>(
								(q) =>
									q
										.from({ message: data.collections.messageCollection })
										.where(({ message }) => inArray(message.id, [...ids])),
								(rows) =>
									MessageListMessage.UpdatedReplyTargets({
										targets: rows.map(({ id, authorId, content }) => ({
											id,
											authorId,
											content,
										})),
									}),
							),
					),
				),
			)

/** The user's read position (today's `readPositionStream`); null while they are not a member. */
export const readPositionStream = (channelId: ChannelId, userId: UserId) =>
	withData((data) => {
		const c = data.collections
		return data.liveQueryStream<
			{ joinedAt: Date; lastReadAt: Date | null | undefined; readStateSince: Date | null | undefined },
			MessageListMessage
		>(
			(q) =>
				q
					.from({ member: c.channelMemberCollection })
					.innerJoin({ channel: c.channelCollection }, ({ member, channel }) =>
						eq(channel.id, member.channelId),
					)
					.innerJoin({ organization: c.organizationCollection }, ({ channel, organization }) =>
						eq(organization.id, channel.organizationId),
					)
					.leftJoin({ read: c.channelReadStateCollection }, ({ member, read }) =>
						eq(read.channelId, member.channelId),
					)
					.where(({ member }) =>
						and(
							eq(member.channelId, channelId),
							eq(member.userId, userId),
							isNull(member.deletedAt),
						),
					)
					.select(({ member, organization, read }) => ({
						joinedAt: member.joinedAt,
						lastReadAt: read?.lastReadAt,
						readStateSince: organization.readStateSince,
					})),
			(rows) => {
				const row = rows[0]
				return MessageListMessage.UpdatedReadPosition({
					readUpToMs:
						row === undefined
							? null
							: (msOf(row.lastReadAt) ??
								Math.max(msOf(row.joinedAt) ?? 0, msOf(row.readStateSince) ?? 0)),
				})
			},
			{ holdEmptyUntil: data.orgSourcesSettled },
		)
	})

/** The channel's newest message, which says whether anything is new since the read position. */
export const activityStream = (channelId: ChannelId) =>
	withData((data) =>
		data.liveQueryStream<{ lastMessageAt: Date; lastMessageAuthorId: UserId }, MessageListMessage>(
			(q) =>
				q
					.from({ activity: data.collections.channelActivityCollection })
					.where(({ activity }) => eq(activity.channelId, channelId))
					.select(({ activity }) => ({
						lastMessageAt: activity.lastMessageAt,
						lastMessageAuthorId: activity.lastMessageAuthorId,
					})),
			(rows) => {
				const row = rows[0]
				return MessageListMessage.UpdatedActivity({
					activity:
						row === undefined
							? null
							: {
									lastMessageAtMs: new Date(row.lastMessageAt).getTime(),
									lastMessageAuthorId: row.lastMessageAuthorId,
								},
				})
			},
			// Before the org's sources settle, no row is not yet "no message".
			{ holdEmptyUntil: data.orgSourcesSettled },
		),
	)

/** Relative times (the thread cards') move on once a minute. */
export const clockStream = Stream.fromEffectSchedule(
	Effect.map(Clock.currentTimeMillis, (nowMs) => MessageListMessage.Ticked({ nowMs })),
	Schedule.spaced(Duration.minutes(1)),
)

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

/** Mutations fail quietly here: the optimistic row rolls back, which is what the user sees. */
const quietly = <E, R>(effect: Effect.Effect<unknown, E, R>) =>
	effect.pipe(
		// BOUNDARY: a failed toggle or pin rolls its optimistic row back; nothing else to show.
		Effect.tapCause((cause) => Effect.logWarning("message list action failed", cause)),
		Effect.catchCause(() => Effect.void),
		Effect.as(MessageListMessage.CompletedCommand()),
	)

/** Adds or removes the user's reaction (`messageReaction.toggle`, optimistic). */
export class ToggleReaction extends Command.Service<ToggleReaction>()("hazel/chat/ToggleReaction", {
	args: { messageId: MessageId, channelId: ChannelId, userId: UserId, emoji: Schema.String },
	success: MessageListMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return (args) =>
				quietly(data.actions.toggleReactionAction(args).pipe(Effect.provideService(HazelRpc, rpc)))
		}),
	)
}

/** Pins a message, or unpins it by its pin's id. */
export class TogglePin extends Command.Service<TogglePin>()("hazel/chat/TogglePin", {
	args: {
		messageId: MessageId,
		channelId: ChannelId,
		userId: UserId,
		pinnedId: Schema.NullOr(Schema.String),
	},
	success: MessageListMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ messageId, channelId, userId, pinnedId }) =>
				pinnedId === null
					? quietly(
							data.actions
								.pinMessageAction({ messageId, channelId, userId })
								.pipe(Effect.provideService(HazelRpc, rpc)),
						)
					: quietly(
							data.actions
								.unpinMessageAction({ pinnedMessageId: PinnedMessageId.make(pinnedId) })
								.pipe(Effect.provideService(HazelRpc, rpc)),
						)
		}),
	)
}

/** Hands a request to the host: the composer, threads, links, profiles and dialogs are its own. */
export class RequestHost extends Command.Service<RequestHost>()("hazel/chat/RequestHost", {
	args: { request: HostRequest },
	success: MessageListMessage,
}) {
	static readonly layerWith = (handle: (request: HostRequest) => void) =>
		this.toLayer(
			Effect.succeed(({ request }) =>
				Effect.sync(() => {
					handle(request)
					return MessageListMessage.CompletedCommand()
				}),
			),
		)
}

/** The list, so a Command can scroll it. */
export const ListRef = Renderer.ref("MessageList.list")

/** Scrolls the list to a keyed row (the "New" line, a reply's message). */
export class ScrollToRow extends Command.Service<ScrollToRow>()("hazel/chat/ScrollToRow", {
	args: { key: Schema.String },
	success: MessageListMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const host = yield* Hazel.Host
			return ({ key }) =>
				Effect.gen(function* () {
					const refs = yield* Renderer.Refs
					const node = yield* refs.lookup(ListRef)
					// SAFETY: a ref resolves to the node its host created (`Hazel.HostNode`).
					if (Option.isSome(node)) yield* host.scrollTo(node.value as Hazel.HostNode, { key })
					return MessageListMessage.CompletedCommand()
				})
		}),
	)
}

/** What a host provides: its data instance, its RPC client, and what it does with row requests. */
export const messageListLayer = (
	data: ClientData["Service"],
	rpc: HazelRpc["Service"],
	handle: (request: HostRequest) => void,
) =>
	Layer.mergeAll(
		MoveWindow.layer,
		ToggleReaction.layer,
		TogglePin.layer,
		ScrollToRow.layer,
		RequestHost.layerWith(handle),
	).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				MessageWindows.layer,
				Layer.succeed(ClientData, data),
				Layer.succeed(HazelRpc, rpc),
			),
		),
	)
