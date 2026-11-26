/**
 * The platform services in a bare JavaScriptCore context, each a thin call into the host's Swift
 * (`__native`, `./bridge.ts`). Load `installRuntimeShims` and the runtime baseline before the package.
 */
import type { SourceSnapshot, SourceSnapshotStore, WebSocketConstructor, WebSocketLike } from "@hazel/effect-db-collection"
import { Effect, Layer } from "effect"
import {
	ClientDataConfig,
	Connectivity,
	Ids,
	KeyValue,
	LocalCache,
	Session,
	Sockets,
} from "../services"
import { nativeBridge, type NativeSocketEvent } from "./bridge"
import { HttpClientJsc } from "./http-client"

export { HttpClientJsc, nativeHttpClient } from "./http-client"
export { installRuntimeShims } from "./runtime-shims"
export type { NativeBridge } from "./bridge"

export const IdsJsc = Layer.sync(Ids, () => {
	const native = nativeBridge()
	return { randomUUID: () => native.uuid() }
})

/** `UserDefaults`. */
export const KeyValueJsc = Layer.sync(KeyValue, () => {
	const { kv } = nativeBridge()
	return {
		get: (key) => kv.get(key) ?? null,
		set: (key, value) => kv.set(key, value),
		remove: (key) => kv.remove(key),
	}
})

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

/** A `WebSocketLike` over `URLSessionWebSocketTask`: text frames, subprotocols and close codes. */
class NativeWebSocket implements WebSocketLike {
	readyState = CONNECTING
	onopen: WebSocketLike["onopen"] = null
	onmessage: WebSocketLike["onmessage"] = null
	onclose: WebSocketLike["onclose"] = null
	onerror: WebSocketLike["onerror"] = null
	protocol = ""
	private readonly id: number

	constructor(
		readonly url: string,
		protocols: string | Array<string>,
	) {
		const list = typeof protocols === "string" ? [protocols] : [...protocols]
		this.id = nativeBridge().socket.open(url, list, (event) => this.receive(event))
	}

	private receive(event: NativeSocketEvent) {
		switch (event.type) {
			case "open":
				if (this.readyState !== CONNECTING) return
				this.readyState = OPEN
				this.protocol = event.protocol
				return this.onopen?.({})
			case "message":
				if (this.readyState === OPEN) this.onmessage?.({ data: event.data })
				return
			case "error":
				return this.onerror?.({ message: event.message })
			case "close":
				if (this.readyState === CLOSED) return
				this.readyState = CLOSED
				return this.onclose?.({ code: event.code, reason: event.reason })
		}
	}

	send(data: string): void {
		if (this.readyState !== OPEN) throw new Error("The socket is not open")
		nativeBridge().socket.send(this.id, data)
	}

	close(code = 1000, reason = ""): void {
		if (this.readyState === CLOSING || this.readyState === CLOSED) return
		this.readyState = CLOSING
		nativeBridge().socket.close(this.id, code, reason)
	}
}

export const SocketsJsc = Layer.succeed(Sockets, { WebSocket: NativeWebSocket as WebSocketConstructor })

/** `NWPathMonitor`: calls back when the path becomes satisfied again. */
export const ConnectivityJsc = Layer.sync(Connectivity, () => {
	const { connectivity } = nativeBridge()
	return {
		subscribeOnline: (listener) => {
			const id = connectivity.onOnline(listener)
			return () => connectivity.off(id)
		},
	}
})

/**
 * The gate's session: the token the host was configured with, sent as the sync token and as a
 * bearer. The keychain store and the token exchange are not here yet.
 */
export const SessionJsc = Layer.sync(Session, () => {
	const { config } = nativeBridge()
	return {
		getAccessToken: async () => config.token,
		invalidateAccessToken: () => {},
		authorization: Effect.succeed(config.token === null ? null : `Bearer ${config.token}`),
	}
})

/** Channel states kept in memory for the session (no native SQLite yet): persistence is off. */
const memorySnapshots = (): SourceSnapshotStore => {
	const kept = new Map<string, SourceSnapshot>()
	return {
		keeps: () => true,
		keepsTable: (table) => table !== "typing_indicators",
		read: async (source) => kept.get(source),
		write: async (source, snapshot) => void kept.set(source, snapshot),
		remove: async (source) => void kept.delete(source),
	}
}

export const LocalCacheJsc = Layer.sync(LocalCache, () => ({
	persist: undefined,
	snapshots: memorySnapshots(),
	bind: () => {},
	forget: async () => false,
}))

export const ClientDataConfigJsc = Layer.sync(ClientDataConfig, () => ({
	apiUrl: nativeBridge().config.apiUrl,
	isRetryableError: () => false,
}))

/** Every service, Swift-backed. */
export const PlatformJsc = Layer.mergeAll(
	IdsJsc,
	KeyValueJsc,
	SocketsJsc,
	ConnectivityJsc,
	SessionJsc,
	LocalCacheJsc,
	ClientDataConfigJsc,
	HttpClientJsc,
)
