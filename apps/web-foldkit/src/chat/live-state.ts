import { ACTOR_SERVICE_ERROR_UI_MESSAGE, isTemporaryActorServiceError } from "@hazel/domain"
import type { MessageEmbed } from "@hazel/domain/models"
import { MessageId } from "@hazel/schema"
import { Duration, Effect, FiberMap, Option, Queue, Ref, Schedule, Schema, Stream } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"

/**
 * AI replies streamed by the Rivet `message` actor: `useMessageActor` (`hooks/use-message-actor.ts`)
 * as a connection Stream plus a reducer over its events. The page keeps one `LiveActorState` per
 * connected message; cached snapshots (completed or failed) never connect.
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
	if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string")
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

/** `stateFromCache`, for snapshots the actor already finished (`shouldUseCached`). */
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

/** Messages that open an actor connection: live, and not answered from the cache. */
export const connectedMessageIds = (
	messages: ReadonlyArray<{ readonly id: MessageId; readonly embeds: ReadonlyArray<EmbedType> | null }>,
): ReadonlyArray<MessageId> =>
	messages
		.filter((message) => liveEmbedOf(message.embeds) !== null && cachedLiveState(message.embeds) === null)
		.map((message) => message.id)
		.sort()

// MESSAGE

/** The actor's events (`MessageActorEvents`), decoded; the snapshot is `getState`'s answer. */
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

const SnapshotPayload = Schema.Struct({
	status: LiveStatus,
	text: Schema.optionalKey(Schema.NullOr(Schema.String)),
	isStreaming: Schema.optionalKey(Schema.Boolean),
	progress: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	error: Schema.optionalKey(Schema.NullOr(Schema.String)),
	steps: Schema.optionalKey(Schema.Array(Schema.Unknown)),
})
const decodeSnapshot = Schema.decodeUnknownOption(SnapshotPayload)

const progressOf = (payload: unknown) =>
	Schema.decodeUnknownOption(Schema.Struct({ progress: Schema.Number }))(payload).pipe(
		Option.map((decoded) => decoded.progress),
	)
const fullTextOf = (payload: unknown) =>
	Schema.decodeUnknownOption(Schema.Struct({ fullText: Schema.String }))(payload).pipe(
		Option.map((decoded) => decoded.fullText),
	)
const textOf = (payload: unknown) =>
	Schema.decodeUnknownOption(Schema.Struct({ text: Schema.String }))(payload).pipe(
		Option.map((decoded) => decoded.text),
	)
const errorOf = (payload: unknown) =>
	Schema.decodeUnknownOption(Schema.Struct({ error: Schema.Unknown }))(payload).pipe(
		Option.map((decoded) => decoded.error),
	)

/** Each actor event as a `LiveEvent`, or nothing when the payload does not decode. */
const eventDecoders: ReadonlyArray<readonly [string, (payload: unknown) => Option.Option<LiveEvent>]> = [
	["started", () => Option.some(LiveEvent.Started())],
	["progress", (payload) => progressOf(payload).pipe(Option.map((progress) => LiveEvent.Progress({ progress })))],
	["textChunk", (payload) => fullTextOf(payload).pipe(Option.map((fullText) => LiveEvent.TextChunk({ fullText })))],
	["textUpdate", (payload) => textOf(payload).pipe(Option.map((text) => LiveEvent.TextUpdate({ text })))],
	["streamEnd", (payload) => textOf(payload).pipe(Option.map((text) => LiveEvent.StreamEnd({ text })))],
	["completed", () => Option.some(LiveEvent.Completed())],
	[
		"failed",
		(payload) =>
			errorOf(payload).pipe(Option.map((error) => LiveEvent.Failed({ error: normalizeActorError(error) }))),
	],
	["stepAdded", () => Option.some(LiveEvent.StepAdded())],
]

const snapshotEvent = (state: unknown): Option.Option<LiveEvent> =>
	decodeSnapshot(state).pipe(
		Option.map((snapshot) =>
			LiveEvent.Snapshot({
				state: {
					status: snapshot.status,
					text: snapshot.text ?? "",
					isStreaming: snapshot.isStreaming ?? false,
					progress: snapshot.progress ?? null,
					error: snapshot.error ?? null,
					stepCount: snapshot.steps?.length ?? 0,
				},
			}),
		),
	)

/** The token fetch, the connection, or the state fetch on open failed for one reply. */
export class LiveConnectionError extends Schema.TaggedError<LiveConnectionError>()("LiveConnectionError", {
	messageId: MessageId,
	stage: Schema.Literals(["connect", "state"]),
	cause: Schema.Defect(),
}) {}

/** `getOrCreate([messageId], { params: { token } }).connect()` with every actor event forwarded. */
const openConnection = (
	messageId: MessageId,
	offer: (event: Option.Option<LiveEvent>) => void,
	onOpen: () => void,
) =>
	Effect.tryPromise({
		try: async () => {
			const { rivetClient, getAccessToken } = await import("~/lib/rivet-client")
			const token = await getAccessToken()
			const connection = rivetClient.message.getOrCreate([messageId], { params: { token: token ?? "" } }).connect()
			connection.onOpen(onOpen)
			for (const [name, decode] of eventDecoders)
				connection.on(name, (payload: unknown) => offer(decode(payload)))
			return connection
		},
		catch: (cause) => new LiveConnectionError({ messageId, stage: "connect", cause }),
	})

/**
 * One message's actor connection: the state fetched on every open, then every event. Disposed when
 * the Stream ends (the row leaves the page). A failure ends only this reply's connection (legacy
 * leaves the row idle), it never reaches the other replies or the runtime.
 */
export const liveEventStream = (messageId: MessageId): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.gen(function* () {
			const offer = (event: Option.Option<LiveEvent>) => {
				if (Option.isSome(event))
					Queue.offerUnsafe(queue, Message.ReceivedLiveEvent({ messageId, event: event.value }))
			}
			const opened = yield* Queue.unbounded<void>()
			const connection = yield* Effect.acquireRelease(
				openConnection(messageId, offer, () => Queue.offerUnsafe(opened, undefined)),
				(connection) => Effect.tryPromise(() => connection.dispose()).pipe(Effect.ignore),
			)
			// Scoped to the stream: a late `getState` answer after release is interrupted, not offered.
			yield* Queue.take(opened).pipe(
				Effect.andThen(
					Effect.tryPromise({
						try: (): Promise<unknown> => connection.getState(),
						catch: (cause) => new LiveConnectionError({ messageId, stage: "state", cause }),
					}),
				),
				Effect.tap((state) => Effect.sync(() => offer(snapshotEvent(state)))),
				Effect.catchTag("LiveConnectionError", (error) => Effect.logWarning(error)),
				Effect.forever,
			)
		}).pipe(Effect.catchTag("LiveConnectionError", (error) => Effect.logWarning(error))),
	)

/** How often the live set is re-read; a new reply connects within this delay. */
const RECONCILE_INTERVAL = Duration.millis(250)

/**
 * Every live reply's connection, keyed by message id: a reply that joins the set connects, one that
 * leaves is disposed, and the others keep their connection (no reconnect, no snapshot re-fetch).
 */
export const liveRepliesStream = (readIds: () => ReadonlyArray<MessageId>): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.gen(function* () {
			const connections = yield* FiberMap.make<MessageId>()
			const connected = yield* Ref.make<ReadonlySet<MessageId>>(new Set())
			const reconcile = Effect.gen(function* () {
				const wanted: ReadonlySet<MessageId> = new Set(readIds())
				const current = yield* Ref.get(connected)
				yield* Effect.forEach(
					[...current].filter((id) => !wanted.has(id)),
					(id) => FiberMap.remove(connections, id),
					{ discard: true },
				)
				yield* Effect.forEach(
					[...wanted].filter((id) => !current.has(id)),
					(id) =>
						FiberMap.run(
							connections,
							id,
							Stream.runForEach(liveEventStream(id), (message) => Queue.offer(queue, message)),
						),
					{ discard: true },
				)
				yield* Ref.set(connected, wanted)
			})
			yield* reconcile.pipe(Effect.repeat(Schedule.spaced(RECONCILE_INTERVAL)))
		}),
	)
