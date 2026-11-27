import type { MessageEmbed } from "@hazel/domain/models"
import { MessageId } from "@hazel/schema"
import {
	initialLiveState,
	LiveConnection,
	LiveActorState,
	LiveReply,
	liveRepliesStream as sharedRepliesStream,
	liveStateOf,
	reduceLive,
} from "@hazel/shared-screens/chat/rich/live-replies"
import { Schema, Stream } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { invalidateAccessToken, openLiveSocket, readAccessToken } from "~/lib/live-socket"

/**
 * AI replies streamed by their message's `MessageLiveObject`, for the Foldkit thread panel: the
 * socket stream and reducer are the hazel list's (`@hazel/shared-screens/chat/rich/live-replies`),
 * wrapped in this page's Messages. Cached snapshots (completed or failed) never connect.
 */

export { initialLiveState, LiveActorState, LiveReply } from "@hazel/shared-screens/chat/rich/live-replies"

// MODEL

export const LiveStates = Schema.Record(Schema.String, LiveActorState)
export type LiveStates = typeof LiveStates.Type

type EmbedType = MessageEmbed.MessageEmbed

/** The embed that turns live state on, if any (`MessageEmbeds`' `liveStateEmbed`). */
export const liveEmbedOf = (embeds: ReadonlyArray<EmbedType> | null) =>
	embeds?.find((embed) => embed.liveState?.enabled === true)?.liveState ?? null

/** `stateFromCache`, for snapshots the reply already finished (`shouldUseCached`). */
export const cachedLiveState = (embeds: ReadonlyArray<EmbedType> | null): LiveActorState | null => {
	const cached = liveEmbedOf(embeds)?.cached
	if (cached === undefined || (cached.status !== "completed" && cached.status !== "failed")) return null
	return {
		...liveStateOf(
			{ status: cached.status, text: cached.text ?? "", error: cached.error ?? null },
			undefined,
		),
		progress: cached.progress ?? (cached.status === "completed" ? 100 : null),
		stepCount: cached.steps?.length ?? 0,
	}
}

/** Messages that open a live socket: live, and not answered from the cache. */
export const connectedReplies = (
	messages: ReadonlyArray<{
		readonly id: MessageId
		readonly channelId: LiveReply["channelId"]
		readonly embeds: ReadonlyArray<EmbedType> | null
	}>,
): ReadonlyArray<LiveReply> =>
	messages
		.filter((message) => liveEmbedOf(message.embeds) !== null && cachedLiveState(message.embeds) === null)
		.map((message) => ({ messageId: message.id, channelId: message.channelId }))
		.sort((a, b) => (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0))

/** Reuses `previous` when `next` holds the same replies in the same order. */
export const shareReplies = (previous: ReadonlyArray<LiveReply>, next: ReadonlyArray<LiveReply>) =>
	previous.length === next.length &&
	next.every(
		(reply, index) =>
			reply.messageId === previous[index]?.messageId && reply.channelId === previous[index]?.channelId,
	)
		? previous
		: next

// MESSAGE

/** The socket's frames, as the page reduces them. */
export const LiveEvent = defineTaggedUnion({
	Snapshot: { state: LiveActorState },
	Started: {},
	Progress: { progress: Schema.Finite },
	TextChunk: { fullText: Schema.String },
	TextUpdate: { text: Schema.String },
	StreamEnd: { text: Schema.String },
	Completed: {},
	Failed: { error: Schema.String },
	StepAdded: {},
})
export type LiveEvent = typeof LiveEvent.Type

export const Message = defineMessageUnion({
	ReceivedLiveEvent: { messageId: MessageId, event: LiveEvent },
})
export type Message = typeof Message.Type

export const applyMessage = (states: LiveStates, message: Message): LiveStates =>
	Message.match<LiveStates>(message, {
		ReceivedLiveEvent: ({ messageId, event }) => ({
			...states,
			[messageId]: reduceLive(states[messageId] ?? initialLiveState, event),
		}),
	})

// STREAM

/** The app's live sockets and access token. */
const connection: LiveConnection["Service"] = {
	open: (reply, token) => openLiveSocket(reply.messageId, reply.channelId, token),
	readToken: () => readAccessToken(),
	invalidateToken: invalidateAccessToken,
}

export const liveConnection = connection

/** Every live reply's socket, keyed by message id (the shared stream, as this page's Messages). */
export const liveRepliesStream = (readReplies: () => ReadonlyArray<LiveReply>): Stream.Stream<Message> =>
	sharedRepliesStream(readReplies).pipe(
		Stream.map(({ messageId, event }) => Message.ReceivedLiveEvent({ messageId, event })),
		Stream.provideService(LiveConnection, connection),
	)
