/**
 * The multiplexed sync socket (`GET /sync/mux`): every source of a client over one WebSocket, so a
 * load pays one handshake instead of one per source (browsers open WebSockets to a host one
 * handshake at a time). The api Worker opens a socket to each source's object and relays frames.
 *
 * The client opens a source as a stream with an id of its own (never reused on the socket, so a
 * late frame of a stream it closed cannot reach the source's next one). Each stream carries the
 * per-source protocol (`./protocol.ts`), unchanged and unparsed: a data frame is `<id>\n<frame>`,
 * both ways. A control frame is a JSON object (it starts with `{`): the client opens and closes
 * streams, the Worker says a stream opened or closed, with the close code a per-source socket
 * would have had.
 */
import { Schema } from "effect"
import { SyncSourceKind } from "./protocol"

/** The subprotocol a client offers on `GET /sync/mux`; the access token rides as the second entry. */
export const SYNC_MUX_SUBPROTOCOL = "hazel.mux.v1"

const StreamId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Open stream `id` to `kind`/`id` with `token` (verified per stream: it carries the expiry the
 * object enforces, and a `Reauth` on the stream moves it).
 */
export const SyncMuxOpen = Schema.TaggedStruct("Open", {
	id: StreamId,
	kind: SyncSourceKind,
	sourceId: Schema.String,
	token: Schema.String,
})

/** Close stream `id`. */
export const SyncMuxClose = Schema.TaggedStruct("Close", { id: StreamId })

export const SyncMuxClientControl = Schema.Union([SyncMuxOpen, SyncMuxClose])
export type SyncMuxClientControl = typeof SyncMuxClientControl.Type

/** The source's object accepted stream `id`: its frames follow. */
export const SyncMuxOpened = Schema.TaggedStruct("Opened", { id: StreamId })

/** Stream `id` closed, with the code and reason its own socket would have closed with. */
export const SyncMuxClosed = Schema.TaggedStruct("Closed", {
	id: StreamId,
	code: Schema.Int,
	reason: Schema.String,
})

export const SyncMuxServerControl = Schema.Union([SyncMuxOpened, SyncMuxClosed])
export type SyncMuxServerControl = typeof SyncMuxServerControl.Type

export const encodeMuxData = (id: number, frame: string): string => `${id}\n${frame}`

/** A data frame's stream and frame; `undefined` for a control frame (or garbage). */
export const decodeMuxData = (data: string): { readonly id: number; readonly frame: string } | undefined => {
	const newline = data.indexOf("\n")
	if (newline <= 0 || newline > 10) return undefined
	const id = Number(data.slice(0, newline))
	return Number.isInteger(id) && id >= 0 ? { id, frame: data.slice(newline + 1) } : undefined
}
