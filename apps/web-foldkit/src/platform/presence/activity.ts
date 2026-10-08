import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Dom } from "foldkit"
import { ACTIVITY_THROTTLE_MS } from "./model"

/**
 * `lastActivityAtom`'s browser wiring: local input events, and activity other tabs share through a
 * BroadcastChannel (or `localStorage` where that is missing).
 */

const CHANNEL_NAME = "hazel:presence-activity"
const STORAGE_KEY = "hazel:presence-activity:last"
const tabId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`

const ActivityEnvelope = Schema.Struct({
	type: Schema.Literal("activity"),
	at: Schema.Finite,
	tabId: Schema.String,
})
const decodeEnvelope = Schema.decodeUnknownOption(ActivityEnvelope)
const decodeEnvelopeJson = Schema.decodeUnknownOption(Schema.fromJsonString(ActivityEnvelope))

const fromOtherTab = (envelope: Option.Option<typeof ActivityEnvelope.Type>) =>
	envelope.pipe(
		Option.filter((found) => found.tabId !== tabId),
		Option.map((found) => found.at),
	)

const hasBroadcastChannel = () => typeof BroadcastChannel !== "undefined"

/**
 * `broadcastActivity`: tell the other tabs this one saw input at `at`. A channel per post (at most
 * one a second) keeps no handle alive between Commands; posted messages still arrive after `close`.
 */
export const broadcastActivity = (at: number): Effect.Effect<void> =>
	(hasBroadcastChannel()
		? Effect.acquireUseRelease(
				Effect.try(() => new BroadcastChannel(CHANNEL_NAME)),
				(sender) => Effect.try(() => sender.postMessage({ type: "activity", at, tabId })),
				(sender) => Effect.sync(() => sender.close()),
			)
		: Effect.try(() =>
				localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: "activity", at, tabId, nonce: Math.random() })),
			)
	).pipe(Effect.ignore)

const ACTIVITY_EVENTS = ["mousemove", "keydown", "scroll", "click", "touchstart"] as const

/** Local input (and the tab becoming visible), at most once per throttle window. */
export const localActivity: Stream.Stream<number> = Stream.suspend(() => {
	let lastEmittedMs = Number.NEGATIVE_INFINITY
	const inputs = ACTIVITY_EVENTS.map((type) =>
		Dom.streamFromEvent({
			target: window,
			type,
			mapEvent: () => undefined,
			options: { passive: true },
		}),
	)
	const visible = Dom.streamFromEventFilterMap({
		target: document,
		type: "visibilitychange",
		filterMapEvent: () =>
			document.visibilityState === "visible" ? Option.some(undefined) : Option.none(),
	})
	return Stream.mergeAll([...inputs, visible], { concurrency: "unbounded" }).pipe(
		Stream.map(() => Date.now()),
		Stream.filter((atMs) => {
			if (atMs - lastEmittedMs < ACTIVITY_THROTTLE_MS) return false
			lastEmittedMs = atMs
			return true
		}),
	)
})

/** Activity timestamps other tabs broadcast. */
export const remoteActivity: Stream.Stream<number> = Stream.suspend(() =>
	hasBroadcastChannel()
		? Stream.callback<number>((queue) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						const channel = new BroadcastChannel(CHANNEL_NAME)
						channel.addEventListener("message", (event) =>
							Option.map(fromOtherTab(decodeEnvelope(event.data)), (at) =>
								Queue.offerUnsafe(queue, at),
							),
						)
						return channel
					}),
					(channel) => Effect.sync(() => channel.close()),
				).pipe(Effect.flatMap(() => Effect.never)),
			)
		: Dom.streamFromEventFilterMap({
				target: window,
				type: "storage",
				filterMapEvent: (event) =>
					event.key === STORAGE_KEY && event.newValue !== null
						? fromOtherTab(decodeEnvelopeJson(event.newValue))
						: Option.none(),
			}),
)
