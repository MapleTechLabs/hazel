/**
 * Every source connection over one WebSocket (`/sync/mux`, `@hazel/domain/sync` `mux.ts`). A
 * browser opens WebSockets to a host one handshake at a time, so a socket per source costs a load
 * one handshake per source, in turn; through the mux a load pays for one.
 *
 * The mux hands each {@link SyncConnection} a stream that behaves as its own WebSocket would (it is
 * the connection's `WebSocket` constructor), so reconnects, resumes, `Reauth` and close codes work
 * unchanged: a stream opens once its source's object accepted it, and closes with the code the
 * source's own socket would have. When the shared socket goes, every stream closes with its code,
 * and each connection reconnects on its own backoff, through the next shared socket.
 */
import {
	decodeMuxData,
	encodeMuxData,
	SYNC_MUX_SUBPROTOCOL,
	type SyncMuxClientControl,
	SyncMuxServerControl,
	type SyncSourceKind,
} from "@hazel/domain/sync"
import { Result, Schema } from "effect"
import { consoleLogger, type SyncLogger, type WebSocketConstructor, type WebSocketLike } from "./types"

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

/** A socket the server never answered: its streams close with this, and reconnect. */
const ABNORMAL = 1006

const decodeControl = Schema.decodeUnknownResult(Schema.fromJsonString(SyncMuxServerControl))

const SOURCE_PATH = /\/sync\/(org|channel|user)\/([^/?]+)$/

export interface SyncMuxOptions {
	/** The sync Worker's origin, `http(s)://` or `ws(s)://`. */
	readonly baseUrl: string
	/** Injected in tests; defaults to `globalThis.WebSocket`. */
	readonly WebSocket?: WebSocketConstructor
	/** How long the shared socket stays open without streams, so a reconnect reuses it. @default 10000 */
	readonly idleCloseMs?: number
	readonly log?: SyncLogger
}

/** One source's stream: what its connection sees as its socket. */
class MuxStream implements WebSocketLike {
	readyState = CONNECTING
	onopen: ((event: unknown) => void) | null = null
	onmessage: ((event: { readonly data: unknown }) => void) | null = null
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null
	onerror: ((event: unknown) => void) | null = null

	constructor(
		private readonly mux: SyncMux,
		readonly id: number,
		readonly kind: SyncSourceKind,
		readonly sourceId: string,
		readonly token: string,
	) {}

	send(data: string): void {
		if (this.readyState !== OPEN) throw new Error("The sync stream is not open")
		this.mux.sendData(this.id, data)
	}

	close(): void {
		if (this.readyState === CLOSED) return
		this.readyState = CLOSED
		this.mux.closeStream(this)
	}

	opened(): void {
		if (this.readyState !== CONNECTING) return
		this.readyState = OPEN
		this.onopen?.({})
	}

	deliver(frame: string): void {
		if (this.readyState === OPEN) this.onmessage?.({ data: frame })
	}

	closed(code: number, reason: string): void {
		if (this.readyState === CLOSED) return
		this.readyState = CLOSED
		this.onclose?.({ code, reason })
	}
}

export class SyncMux {
	/** Pass as a connection's `WebSocket`: `new` opens a stream to the URL's source. */
	readonly WebSocket: WebSocketConstructor

	private readonly options: SyncMuxOptions
	private readonly log: SyncLogger
	private readonly url: string
	private socket: WebSocketLike | null = null
	private isOpen = false
	/** Never reused on a socket (nor across them), so a late frame finds no stream. */
	private nextId = 0
	private readonly streams = new Map<number, MuxStream>()
	private idleTimer: ReturnType<typeof setTimeout> | undefined

	constructor(options: SyncMuxOptions) {
		this.options = options
		this.log = options.log ?? consoleLogger
		this.url = `${options.baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/sync/mux`
		const mux = this
		// A constructor that returns an object: `new` yields the stream.
		this.WebSocket = function MuxWebSocket(url: string, protocols: string | Array<string>) {
			return mux.openStream(url, protocols)
		} as unknown as WebSocketConstructor
	}

	/** Closes the shared socket; its streams close as if it dropped. */
	close(): void {
		this.clearIdleTimer()
		const ws = this.socket
		if (ws !== null) this.detach(ws, 1000, "closed")
		this.closeStreams(1000, "closed")
	}

	sendData(id: number, frame: string): void {
		this.socket?.send(encodeMuxData(id, frame))
	}

	closeStream(stream: MuxStream): void {
		if (this.streams.get(stream.id) !== stream) return
		this.streams.delete(stream.id)
		if (this.isOpen) this.sendControl({ _tag: "Close", id: stream.id })
		if (this.streams.size === 0) this.scheduleIdleClose()
	}

	private openStream(url: string, protocols: string | Array<string>): MuxStream {
		const match = SOURCE_PATH.exec(url)
		const token = Array.isArray(protocols) ? protocols[1] : undefined
		if (match === null || token === undefined) throw new Error(`Not a sync source socket: ${url}`)
		const stream = new MuxStream(
			this,
			this.nextId++,
			match[1] as SyncSourceKind,
			decodeURIComponent(match[2]!),
			token,
		)
		this.streams.set(stream.id, stream)
		this.clearIdleTimer()
		if (this.socket === null) this.connect(token)
		else if (this.isOpen) this.announce(stream)
		return stream
	}

	/** Opens the shared socket with the token of the stream that needed it. */
	private connect(token: string): void {
		const Ctor = this.options.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketConstructor)
		let ws: WebSocketLike
		try {
			ws = new Ctor(this.url, [SYNC_MUX_SUBPROTOCOL, token])
		} catch (cause) {
			this.log("warning", "Could not open the sync socket", { cause })
			// The connections retry on their backoff, after this call returned their streams.
			queueMicrotask(() => this.closeStreams(ABNORMAL, "unavailable"))
			return
		}
		this.socket = ws
		this.isOpen = false
		ws.onopen = () => {
			if (this.socket !== ws) return
			this.isOpen = true
			for (const stream of this.streams.values()) this.announce(stream)
		}
		ws.onmessage = (event) => {
			if (this.socket !== ws) return
			if (typeof event.data === "string") this.onFrame(event.data)
		}
		ws.onclose = (event) => {
			if (this.socket !== ws) return
			this.socket = null
			this.isOpen = false
			this.clearIdleTimer()
			this.closeStreams(event.code, event.reason)
		}
		// A close event always follows.
		ws.onerror = () => {}
	}

	private announce(stream: MuxStream): void {
		this.sendControl({
			_tag: "Open",
			id: stream.id,
			kind: stream.kind,
			sourceId: stream.sourceId,
			token: stream.token,
		})
	}

	private onFrame(data: string): void {
		const routed = decodeMuxData(data)
		if (routed !== undefined) {
			this.streams.get(routed.id)?.deliver(routed.frame)
			return
		}
		const decoded = decodeControl(data)
		if (Result.isFailure(decoded)) {
			this.log("warning", "Unknown sync mux frame", { cause: decoded.failure })
			return
		}
		const control = decoded.success
		const stream = this.streams.get(control.id)
		if (stream === undefined) return
		if (control._tag === "Opened") return stream.opened()
		this.streams.delete(control.id)
		if (this.streams.size === 0) this.scheduleIdleClose()
		stream.closed(control.code, control.reason)
	}

	private sendControl(frame: SyncMuxClientControl): void {
		try {
			this.socket?.send(JSON.stringify(frame))
		} catch (cause) {
			this.log("warning", "Sync mux send failed", { cause })
		}
	}

	private closeStreams(code: number, reason: string): void {
		const streams = [...this.streams.values()]
		this.streams.clear()
		for (const stream of streams) stream.closed(code, reason)
	}

	private scheduleIdleClose(): void {
		this.clearIdleTimer()
		this.idleTimer = setTimeout(() => {
			this.idleTimer = undefined
			const ws = this.socket
			if (ws !== null && this.streams.size === 0) this.detach(ws, 1000, "idle")
		}, this.options.idleCloseMs ?? 10_000)
	}

	private clearIdleTimer(): void {
		if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
		this.idleTimer = undefined
	}

	private detach(ws: WebSocketLike, code: number, reason: string): void {
		if (this.socket === ws) {
			this.socket = null
			this.isOpen = false
		}
		ws.onopen = null
		ws.onmessage = null
		ws.onclose = null
		ws.onerror = null
		try {
			ws.close(code, reason)
		} catch {
			// Already closed.
		}
	}
}
