/**
 * The multiplexed sync socket's relay (`GET /sync/mux`, `@hazel/domain/sync` `mux.ts`): one client
 * socket, and per stream the client opens, a socket to that stream's source object.
 *
 * - The client socket and each object socket are effect `Socket`s (`Socket.fromWebSocket`): a
 *   pull loop per socket, and a close is a `SocketCloseError` carrying its code.
 * - The relays live in a `FiberMap` keyed by stream id: an `Open` runs one, a `Close` interrupts
 *   it, and the session's scope ends them all when the client goes. Each relay's scope owns its
 *   object socket, so interrupting it closes that socket.
 * - Frames pass through unparsed: the relay only prefixes the stream id (`encodeMuxData`).
 *
 * The session runs detached from the upgrade request (the response must return for the socket to
 * open), started by {@link startMuxSession}. Each fiber has its own dispatcher, and the sockets'
 * events resume it, so its work stays in the request's I/O context, which workerd keeps alive while
 * the client socket is open.
 */
import {
	decodeMuxData,
	encodeMuxData,
	SyncMuxClientControl,
	type SyncMuxOpen,
	type SyncMuxServerControl,
} from "@hazel/domain/sync"
import { Array as Arr, Effect, FiberMap, Option, Schema } from "effect"
import { Socket } from "effect/socket"

const utf8 = new TextDecoder()

/** What opening a stream's object socket gave: the socket, or the close code the client gets. */
export type MuxOpenResult =
	| { readonly _tag: "Opened"; readonly socket: Socket.WebSocketLike }
	| { readonly _tag: "Refused"; readonly code: number; readonly reason: string }

export const refuseMuxStream = (code: number, reason: string): MuxOpenResult => ({
	_tag: "Refused",
	code,
	reason,
})

/** A relay that failed for a reason other than its object closing it; the client retries. */
const RELAY_FAILED = 1011

const decodeControl = Schema.decodeUnknownOption(Schema.fromJsonString(SyncMuxClientControl))

const closeQuietly = (socket: Socket.WebSocketLike, code: number, reason: string) =>
	Effect.sync(() => {
		try {
			socket.close(code, reason)
		} catch {
			// Already closed.
		}
	})

/**
 * Relays `client` until it closes. `open` opens one stream's object socket (accepted, so open)
 * after checking the stream's token.
 */
export const runMuxSession = Effect.fnUntraced(function* (
	client: Socket.WebSocketLike,
	open: (stream: typeof SyncMuxOpen.Type) => Effect.Effect<MuxOpenResult>,
) {
	const clientSocket = yield* Socket.fromWebSocket(Effect.succeed(client))
	const { pull } = yield* clientSocket.reader
	const { write, writeAll } = yield* clientSocket.writer
	const relays = yield* FiberMap.make<number>()
	// Where a client data frame for each stream goes: the object socket of its running relay.
	const upstreams = new Map<number, Socket.WebSocketLike>()

	const sendControl = (frame: SyncMuxServerControl) => write(JSON.stringify(frame)).pipe(Effect.ignore)

	const relay = (stream: typeof SyncMuxOpen.Type) =>
		Effect.gen(function* () {
			const { id } = stream
			// Opening is the acquire, so it is uninterruptible: a stream closed (or a client gone)
			// while its object answers waits for the socket, and the release closes it.
			const opened = yield* Effect.acquireRelease(open(stream), (result) =>
				result._tag === "Opened" ? closeQuietly(result.socket, 1000, "closed") : Effect.void,
			)
			if (opened._tag === "Refused") {
				return yield* sendControl({ _tag: "Closed", id, code: opened.code, reason: opened.reason })
			}
			const upstream = yield* Socket.fromWebSocket(Effect.succeed(opened.socket))
			const { pull: pullUpstream } = yield* upstream.reader
			upstreams.set(id, opened.socket)
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					if (upstreams.get(id) === opened.socket) upstreams.delete(id)
				}),
			)
			yield* sendControl({ _tag: "Opened", id })
			// Fails when either side goes: the object closed its socket, or the client is gone.
			const error = yield* pullUpstream.pipe(
				Effect.flatMap((frames) =>
					writeAll(
						Arr.map(frames, (frame) =>
							encodeMuxData(id, typeof frame === "string" ? frame : utf8.decode(frame)),
						),
					),
				),
				Effect.forever,
				Effect.flip,
			)
			const reason = error.reason
			yield* sendControl(
				reason._tag === "SocketCloseError"
					? { _tag: "Closed", id, code: reason.code, reason: reason.closeReason ?? "" }
					: { _tag: "Closed", id, code: RELAY_FAILED, reason: "relay_failed" },
			)
		}).pipe(Effect.scoped)

	const onFrame = (data: string | Uint8Array) =>
		Effect.gen(function* () {
			if (typeof data !== "string") return
			const routed = decodeMuxData(data)
			if (routed !== undefined) {
				const upstream = upstreams.get(routed.id)
				if (upstream === undefined) return
				try {
					upstream.send(routed.frame)
				} catch {
					// The object socket is closing; its relay reports the close.
				}
				return
			}
			const control = decodeControl(data)
			if (Option.isNone(control)) {
				return yield* Effect.logWarning("Sync mux frame unreadable")
			}
			if (control.value._tag === "Open") {
				yield* FiberMap.run(relays, control.value.id, relay(control.value))
			} else {
				yield* FiberMap.remove(relays, control.value.id)
			}
		})

	// Ends when the client closes (a `SocketError`); the scope then ends every relay.
	yield* pull.pipe(
		Effect.flatMap((frames) => Effect.forEach(frames, onFrame, { discard: true })),
		Effect.forever,
		Effect.catchTag("SocketError", () => Effect.void),
	)
})

/**
 * Runs {@link runMuxSession} detached from the upgrade request. It starts at once, so it listens
 * before the response goes out: workerd delivers the client's first frames as soon as the socket
 * opens, and drops those that arrive before a listener does.
 */
export const startMuxSession = (
	client: Socket.WebSocketLike,
	open: (stream: typeof SyncMuxOpen.Type) => Effect.Effect<MuxOpenResult>,
): Effect.Effect<void> =>
	runMuxSession(client, open).pipe(
		Effect.scoped,
		Effect.forkDetach({ startImmediately: true }),
		Effect.asVoid,
	)
