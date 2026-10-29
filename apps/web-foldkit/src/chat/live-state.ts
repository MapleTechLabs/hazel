import { ACTOR_SERVICE_ERROR_UI_MESSAGE, isTemporaryActorServiceError } from "@hazel/domain"
import { decodeLiveServerFrame, LiveServerFrame } from "@hazel/domain/live"
import type { MessageEmbed } from "@hazel/domain/models"
import { SyncCloseCode } from "@hazel/domain/sync"
import { ChannelId, MessageId } from "@hazel/schema"
import { Duration, Effect, FiberMap, Option, Queue, Random, Ref, Schedule, Schema, Stream } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { invalidateAccessToken, type LiveSocket, openLiveSocket, readAccessToken } from "~/lib/live-socket"

/**
 * AI replies streamed by their message's `MessageLiveObject` (`/live/:messageId`): a socket Stream
 * per reply plus a reducer over its events. The page keeps one `LiveActorState` per connected
 * message; cached snapshots (completed or failed) never connect.
 */

// MODEL

export const LiveStatus = Schema.Literals(["idle", "active", "completed", "failed"])

export const LiveActorState = Schema.Struct({
	status: LiveStatus,
	text: Schema.String,
	isStreaming: Schema.Boolean,
	progress: Schema.NullOr(Schema.Number),
	error: Schema.NullOr(Schema.String),
	/** Agent steps are counted (they end the loading state) but not rendered yet. */
	stepCount: Schema.Number,
})
export type LiveActorState = typeof LiveActorState.Type

export const LiveStates = Schema.Record(Schema.String, LiveActorState)
export type LiveStates = typeof LiveStates.Type

/** A reply with a live socket: its message and the channel the socket is authorized against. */
export const LiveReply = Schema.Struct({ messageId: MessageId, channelId: ChannelId })
export type LiveReply = typeof LiveReply.Type

export const initialLiveState: LiveActorState = {
	status: "idle",
	text: "",
	isStreaming: false,
	progress: null,
	error: null,
	stepCount: 0,
}

const errorMessageOf = (error: unknown): string => {
	if (typeof error === "string") return error
	if (error instanceof Error) return error.message
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	)
		return error.message
	return "Connection failed. Please try again."
}

/** `normalizeMessageActorError`. */
export const normalizeActorError = (error: unknown): string =>
	isTemporaryActorServiceError(error) ? ACTOR_SERVICE_ERROR_UI_MESSAGE : errorMessageOf(error)

type EmbedType = MessageEmbed.MessageEmbed

/** The embed that turns live state on, if any (`MessageEmbeds`' `liveStateEmbed`). */
export const liveEmbedOf = (embeds: ReadonlyArray<EmbedType> | null) =>
	embeds?.find((embed) => embed.liveState?.enabled === true)?.liveState ?? null

/** `stateFromCache`, for snapshots the reply already finished (`shouldUseCached`). */
export const cachedLiveState = (embeds: ReadonlyArray<EmbedType> | null): LiveActorState | null => {
	const cached = liveEmbedOf(embeds)?.cached
	if (cached === undefined || (cached.status !== "completed" && cached.status !== "failed")) return null
	return {
		status: cached.status,
		text: cached.text ?? "",
		isStreaming: false,
		progress: cached.progress ?? (cached.status === "completed" ? 100 : null),
		error: cached.error ? normalizeActorError(cached.error) : null,
		stepCount: cached.steps?.length ?? 0,
	}
}

/** Messages that open a live socket: live, and not answered from the cache. */
export const connectedReplies = (
	messages: ReadonlyArray<{
		readonly id: MessageId
		readonly channelId: ChannelId
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
	Progress: { progress: Schema.Number },
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

/** `useMessageActor`'s `setState` updaters. */
const reduce = (state: LiveActorState, event: LiveEvent): LiveActorState =>
	LiveEvent.match<LiveActorState>(event, {
		Snapshot: ({ state: snapshot }) => snapshot,
		Started: () => ({ ...state, status: "active" }),
		Progress: ({ progress }) => ({ ...state, progress }),
		TextChunk: ({ fullText }) => ({ ...state, text: fullText, isStreaming: true }),
		TextUpdate: ({ text }) => ({ ...state, text }),
		StreamEnd: ({ text }) => ({ ...state, text, isStreaming: false }),
		Completed: () => ({ ...state, status: "completed", isStreaming: false, progress: 100 }),
		Failed: ({ error }) => ({ ...state, status: "failed", error, isStreaming: false }),
		StepAdded: () => ({ ...state, stepCount: state.stepCount + 1 }),
	})

export const applyMessage = (states: LiveStates, message: Message): LiveStates =>
	Message.match<LiveStates>(message, {
		ReceivedLiveEvent: ({ messageId, event }) => ({
			...states,
			[messageId]: reduce(states[messageId] ?? initialLiveState, event),
		}),
	})

// STREAM

/** A frame as a `LiveEvent`; the stream keeps the reply's text so chunks carry the whole of it. */
const eventOf = (frame: LiveServerFrame, text: { current: string }): Option.Option<LiveEvent> =>
	LiveServerFrame.match(frame, {
		Snapshot: ({ state }) => {
			text.current = state.text
			return Option.some(
				LiveEvent.Snapshot({
					state: {
						status: state.status,
						text: state.text,
						isStreaming: state.isStreaming,
						progress: state.progress,
						error: state.error === null ? null : normalizeActorError(state.error),
						stepCount: state.steps.length,
					},
				}),
			)
		},
		Started: () => Option.some(LiveEvent.Started()),
		DataUpdated: () => Option.none(),
		Progress: ({ progress }) => Option.some(LiveEvent.Progress({ progress })),
		TextAppended: ({ chunk }) => {
			text.current += chunk
			return Option.some(LiveEvent.TextChunk({ fullText: text.current }))
		},
		TextReplaced: ({ text: replaced }) => {
			text.current = replaced
			return Option.some(LiveEvent.TextUpdate({ text: replaced }))
		},
		StreamEnded: () => Option.some(LiveEvent.StreamEnd({ text: text.current })),
		Completed: () => Option.some(LiveEvent.Completed()),
		Failed: ({ error }) => Option.some(LiveEvent.Failed({ error: normalizeActorError(error) })),
		StepAdded: () => Option.some(LiveEvent.StepAdded()),
		StepStarted: () => Option.none(),
		StepContent: () => Option.none(),
		StepCompleted: () => Option.none(),
		Pong: () => Option.none(),
	})

/** Opening the socket threw (a malformed URL, a blocked scheme). */
export class LiveConnectionError extends Schema.TaggedError<LiveConnectionError>()("LiveConnectionError", {
	messageId: MessageId,
	cause: Schema.Defect(),
}) {}

/** The object refused the reader (not a viewer, no such message): retrying would not help. */
const isFinalClose = (code: number) => code === SyncCloseCode.Forbidden || code === SyncCloseCode.NotFound

/** Waits before reconnecting: exponential, capped at 30 s, jittered. */
const backoff = (attempt: number) =>
	Effect.flatMap(Random.next, (jitter) =>
		Effect.sleep(Duration.millis(Math.min(30_000, 500 * 2 ** attempt) * (0.5 + jitter / 2))),
	)

/** One socket, from open to close: each frame offered as it arrives; answers the close code. */
const socketSession = (
	reply: LiveReply,
	token: string,
	offer: (event: LiveEvent) => void,
	opened: () => void,
) =>
	Effect.callback<number, LiveConnectionError>((resume) => {
		let socket: LiveSocket
		try {
			socket = openLiveSocket(reply.messageId, reply.channelId, token)
		} catch (cause) {
			resume(Effect.fail(new LiveConnectionError({ messageId: reply.messageId, cause })))
			return
		}
		const text = { current: "" }
		socket.onopen = opened
		socket.onmessage = (event) => {
			if (typeof event.data !== "string") return
			const live = Option.flatMap(decodeLiveServerFrame(event.data), (frame) => eventOf(frame, text))
			if (Option.isSome(live)) offer(live.value)
		}
		socket.onclose = (event) => resume(Effect.succeed(event.code))
		// A close event always follows.
		socket.onerror = () => {}
		return Effect.sync(() => {
			socket.onclose = null
			socket.close(1000, "done")
		})
	})

/**
 * One reply's live socket: a snapshot on every open, then each change. Reconnects with backoff
 * (a refused token is dropped first); ends when the object refuses the reader, the user is signed
 * out, or the Stream ends (the row leaves the page). It never fails: one reply's trouble reaches
 * neither the other replies nor the runtime.
 */
export const liveEventStream = (reply: LiveReply): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.gen(function* () {
			const offer = (event: LiveEvent) =>
				Queue.offerUnsafe(queue, Message.ReceivedLiveEvent({ messageId: reply.messageId, event }))
			let attempt = 0
			while (true) {
				const token = yield* Effect.promise(() => readAccessToken())
				if (token === null) return
				if (token !== "unavailable") {
					const code = yield* socketSession(reply, token, offer, () => {
						attempt = 0
					}).pipe(
						Effect.catchTag("LiveConnectionError", (error) =>
							Effect.logWarning(error).pipe(Effect.as(1006)),
						),
					)
					if (isFinalClose(code)) return
					if (code === SyncCloseCode.Reauth) invalidateAccessToken(token)
				}
				yield* backoff(attempt++)
			}
		}),
	)

/** How often the live set is re-read; a new reply connects within this delay. */
const RECONCILE_INTERVAL = Duration.millis(250)

/**
 * Every live reply's socket, keyed by message id: a reply that joins the set connects, one that
 * leaves is closed, and the others keep their socket (no reconnect, no snapshot re-fetch).
 */
export const liveRepliesStream = (readReplies: () => ReadonlyArray<LiveReply>): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.gen(function* () {
			const connections = yield* FiberMap.make<MessageId>()
			const connected = yield* Ref.make<ReadonlySet<MessageId>>(new Set())
			const reconcile = Effect.gen(function* () {
				const wanted = new Map(readReplies().map((reply) => [reply.messageId, reply]))
				const current = yield* Ref.get(connected)
				yield* Effect.forEach(
					[...current].filter((id) => !wanted.has(id)),
					(id) => FiberMap.remove(connections, id),
					{ discard: true },
				)
				yield* Effect.forEach(
					[...wanted.values()].filter((reply) => !current.has(reply.messageId)),
					(reply) =>
						FiberMap.run(
							connections,
							reply.messageId,
							Stream.runForEach(liveEventStream(reply), (message) =>
								Queue.offer(queue, message),
							),
						),
					{ discard: true },
				)
				yield* Ref.set(connected, new Set(wanted.keys()))
			})
			yield* reconcile.pipe(Effect.repeat(Schedule.spaced(RECONCILE_INTERVAL)))
		}),
	)
