/**
 * AI and bot replies that grow while they stream (`MessageLiveObject`, `/live/:messageId`): one
 * socket Stream per reply and a reducer over its events. The host opens the socket and holds the
 * access token (`LiveConnection`); everything else is here, shared by the hazel list and the
 * Foldkit thread panel until it converts.
 */
import { ACTOR_SERVICE_ERROR_UI_MESSAGE, isTemporaryActorServiceError } from "@hazel/domain"
import { decodeLiveServerFrame, LiveServerFrame } from "@hazel/domain/live"
import { SyncCloseCode } from "@hazel/domain/sync"
import { ChannelId, MessageId } from "@hazel/schema"
import {
	Context,
	Duration,
	Effect,
	FiberMap,
	Match,
	Option,
	Queue,
	Random,
	Ref,
	Schedule,
	Schema,
	Stream,
} from "effect"

export const LiveStatus = Schema.Literals(["idle", "active", "completed", "failed"])

export const LiveActorState = Schema.Struct({
	status: LiveStatus,
	text: Schema.String,
	isStreaming: Schema.Boolean,
	progress: Schema.NullOr(Schema.Finite),
	error: Schema.NullOr(Schema.String),
	/** Agent steps are counted (they end the loading state) but not drawn. */
	stepCount: Schema.Finite,
})
export type LiveActorState = typeof LiveActorState.Type

export const initialLiveState: LiveActorState = {
	status: "idle",
	text: "",
	isStreaming: false,
	progress: null,
	error: null,
	stepCount: 0,
}

/** A reply with a live socket: its message and the channel the socket is authorized against. */
export const LiveReply = Schema.Struct({ messageId: MessageId, channelId: ChannelId })
export type LiveReply = typeof LiveReply.Type

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

/** The socket's frames, as the reducer reads them. */
export const LiveEvent = Schema.Union([
	Schema.TaggedStruct("Snapshot", { state: LiveActorState }),
	Schema.TaggedStruct("Started", {}),
	Schema.TaggedStruct("Progress", { progress: Schema.Finite }),
	Schema.TaggedStruct("TextChunk", { fullText: Schema.String }),
	Schema.TaggedStruct("TextUpdate", { text: Schema.String }),
	Schema.TaggedStruct("StreamEnd", { text: Schema.String }),
	Schema.TaggedStruct("Completed", {}),
	Schema.TaggedStruct("Failed", { error: Schema.String }),
	Schema.TaggedStruct("StepAdded", {}),
])
export type LiveEvent = typeof LiveEvent.Type

/** `useMessageActor`'s `setState` updaters. */
export const reduceLive = (state: LiveActorState, event: LiveEvent): LiveActorState =>
	Match.valueTags(event, {
		Snapshot: ({ state: snapshot }) => snapshot,
		Started: () => ({ ...state, status: "active" as const }),
		Progress: ({ progress }) => ({ ...state, progress }),
		TextChunk: ({ fullText }) => ({ ...state, text: fullText, isStreaming: true }),
		TextUpdate: ({ text }) => ({ ...state, text }),
		StreamEnd: ({ text }) => ({ ...state, text, isStreaming: false }),
		Completed: () => ({ ...state, status: "completed" as const, isStreaming: false, progress: 100 }),
		Failed: ({ error }) => ({ ...state, status: "failed" as const, error, isStreaming: false }),
		StepAdded: () => ({ ...state, stepCount: state.stepCount + 1 }),
	})

const some = (event: LiveEvent) => Option.some(event)

/** A frame as an event; `text` keeps the reply's text so chunks carry the whole of it. */
const eventOf = (frame: LiveServerFrame, text: { current: string }): Option.Option<LiveEvent> =>
	LiveServerFrame.match(frame, {
		Snapshot: ({ state }) => {
			text.current = state.text
			return some({
				_tag: "Snapshot",
				state: {
					status: state.status,
					text: state.text,
					isStreaming: state.isStreaming,
					progress: state.progress,
					error: state.error === null ? null : normalizeActorError(state.error),
					stepCount: state.steps.length,
				},
			})
		},
		Started: () => some({ _tag: "Started" }),
		DataUpdated: () => Option.none(),
		Progress: ({ progress }) => some({ _tag: "Progress", progress }),
		TextAppended: ({ chunk }) => {
			text.current += chunk
			return some({ _tag: "TextChunk", fullText: text.current })
		},
		TextReplaced: ({ text: replaced }) => {
			text.current = replaced
			return some({ _tag: "TextUpdate", text: replaced })
		},
		StreamEnded: () => some({ _tag: "StreamEnd", text: text.current }),
		Completed: () => some({ _tag: "Completed" }),
		Failed: ({ error }) => some({ _tag: "Failed", error: normalizeActorError(error) }),
		StepAdded: () => some({ _tag: "StepAdded" }),
		StepStarted: () => Option.none(),
		StepContent: () => Option.none(),
		StepCompleted: () => Option.none(),
		Pong: () => Option.none(),
	})

/** The subset of the DOM `WebSocket` the stream uses. */
export interface LiveSocket {
	onopen: (() => void) | null
	onmessage: ((event: { readonly data: unknown }) => void) | null
	onclose: ((event: { readonly code: number }) => void) | null
	onerror: (() => void) | null
	close(code?: number, reason?: string): void
}

/** What a host gives the stream: the socket to a reply, and its access token. */
export class LiveConnection extends Context.Service<
	LiveConnection,
	{
		readonly open: (reply: LiveReply, token: string) => LiveSocket
		/** The token, `null` when signed out, `"unavailable"` when it cannot be read now. */
		readonly readToken: () => Promise<string | null>
		readonly invalidateToken: (token: string) => void
	}
>()("hazel/chat/LiveConnection") {}

/** A host with no live sockets (the iOS spike, tests): every reply stays on its loading line. */
export const noLiveConnection: LiveConnection["Service"] = {
	open: () => {
		throw new Error("no live sockets on this host")
	},
	readToken: () => Promise.resolve(null),
	invalidateToken: () => {},
}

/** Opening the socket threw (a malformed URL, a blocked scheme). */
export class LiveConnectionError extends Schema.TaggedError<
	LiveConnectionError,
	{ readonly brand: unique symbol }
>()("LiveConnectionError", { messageId: MessageId, cause: Schema.Defect() }) {}

/** The object refused the reader (not a viewer, no such message): retrying would not help. */
const isFinalClose = (code: number) => code === SyncCloseCode.Forbidden || code === SyncCloseCode.NotFound

/** Waits before reconnecting: exponential, capped at 30 s, jittered. */
const backoff = (attempt: number) =>
	Effect.flatMap(Random.next, (jitter) =>
		Effect.sleep(Duration.millis(Math.min(30_000, 500 * 2 ** attempt) * (0.5 + jitter / 2))),
	)

/** One socket, from open to close: each frame offered as it arrives; answers the close code. */
const socketSession = (
	connection: LiveConnection["Service"],
	reply: LiveReply,
	token: string,
	offer: (event: LiveEvent) => void,
	opened: () => void,
) =>
	Effect.callback<number, LiveConnectionError>((resume) => {
		let socket: LiveSocket
		try {
			socket = connection.open(reply, token)
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
 * One reply's events: a snapshot on every open, then each change. Reconnects with backoff (a
 * refused token is dropped first); ends when the object refuses the reader or the user signs out.
 * It never fails: one reply's trouble reaches neither the other replies nor the runtime.
 */
export const liveEventStream = (reply: LiveReply): Stream.Stream<LiveEvent, never, LiveConnection> =>
	Stream.callback<LiveEvent, never, LiveConnection>((queue) =>
		Effect.gen(function* () {
			const connection = yield* LiveConnection
			const offer = (event: LiveEvent) => Queue.offerUnsafe(queue, event)
			let attempt = 0
			while (true) {
				const token = yield* Effect.promise(() => connection.readToken())
				if (token === null) return
				if (token !== "unavailable") {
					const code = yield* socketSession(connection, reply, token, offer, () => {
						attempt = 0
					}).pipe(
						Effect.catchTag("LiveConnectionError", (error) =>
							Effect.logWarning(error).pipe(Effect.as(1006)),
						),
					)
					if (isFinalClose(code)) return
					if (code === SyncCloseCode.Reauth) connection.invalidateToken(token)
				}
				yield* backoff(attempt++)
			}
		}),
	)

/** One reply's event, keyed by its message. */
export interface KeyedLiveEvent {
	readonly messageId: MessageId
	readonly event: LiveEvent
}

/** How often the live set is re-read; a new reply connects within this delay. */
const RECONCILE_INTERVAL = Duration.millis(250)

/**
 * Every live reply's events: a reply that joins the set connects, one that leaves is closed, and
 * the others keep their socket (no reconnect, no snapshot re-fetch).
 */
export const liveRepliesStream = (
	readReplies: () => ReadonlyArray<LiveReply>,
): Stream.Stream<KeyedLiveEvent, never, LiveConnection> =>
	Stream.callback<KeyedLiveEvent, never, LiveConnection>((queue) =>
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
							Stream.runForEach(liveEventStream(reply), (event) =>
								Queue.offer(queue, { messageId: reply.messageId, event }),
							),
						),
					{ discard: true },
				)
				yield* Ref.set(connected, new Set(wanted.keys()))
			})
			yield* reconcile.pipe(Effect.repeat(Schedule.spaced(RECONCILE_INTERVAL)))
		}),
	)

/** A finished snapshot the message carries (`liveState.cached`). */
export interface CachedLive {
	readonly status: "completed" | "failed"
	readonly text: string
	readonly error: string | null
}

/** The reply as the row shows it: the cached snapshot, else what the socket said so far. */
export const liveStateOf = (
	cached: CachedLive | null,
	streamed: LiveActorState | undefined,
): LiveActorState =>
	cached === null
		? (streamed ?? initialLiveState)
		: {
				status: cached.status,
				text: cached.text,
				isStreaming: false,
				progress: cached.status === "completed" ? 100 : null,
				error: cached.error === null ? null : normalizeActorError(cached.error),
				stepCount: 0,
			}

/** Nothing to show yet: the loading line stands in (today's `isWaitingForContent`). */
export const isWaitingForContent = (state: LiveActorState) =>
	state.status === "idle" || (state.status === "active" && !state.text && state.stepCount === 0)
