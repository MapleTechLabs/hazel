/** A scriptable `__native` for the JSC services' tests: records calls, lets a test answer them. */
import type { NativeBridge, NativeHttpEvent, NativeHttpResult, NativeSocketEvent } from "./bridge"

export interface FakeHttpCall {
	readonly id: number
	readonly method: string
	readonly url: string
	readonly headers: Record<string, string>
	readonly body: Uint8Array | null
	readonly emit: (event: NativeHttpEvent) => void
}

export interface FakeSocket {
	readonly id: number
	readonly url: string
	readonly protocols: Array<string>
	readonly emit: (event: NativeSocketEvent) => void
	readonly sent: Array<string | Uint8Array>
	closed?: { code: number; reason: string }
}

export const makeFakeBridge = (overrides: Partial<NativeBridge> = {}) => {
	const http: Array<FakeHttpCall> = []
	const cancelled: Array<number> = []
	const sockets: Array<FakeSocket> = []
	const kv = new Map<string, string>()
	let nextId = 1
	const bridge: NativeBridge = {
		uuid: () => `uuid-${nextId++}`,
		kv: { get: (k) => kv.get(k), set: (k, v) => void kv.set(k, v), remove: (k) => void kv.delete(k) },
		socket: {
			binary: true,
			open: (url, protocols, onEvent) => {
				const socket: FakeSocket = { id: nextId++, url, protocols, emit: onEvent, sent: [] }
				sockets.push(socket)
				return socket.id
			},
			send: (id, data) => void sockets.find((s) => s.id === id)?.sent.push(data),
			close: (id, code, reason) => {
				const socket = sockets.find((s) => s.id === id)
				if (socket !== undefined) socket.closed = { code, reason }
			},
		},
		http: {
			start: (method, url, headers, body, onEvent) => {
				const call = { id: nextId++, method, url, headers, body, emit: onEvent }
				http.push(call)
				return call.id
			},
			cancel: (id) => void cancelled.push(id),
		},
		connectivity: { onOnline: () => nextId++, off: () => {} },
		config: { apiUrl: "http://127.0.0.1:4320", token: null },
		...overrides,
	}
	return { bridge, http, cancelled, sockets, kv }
}

/** Answers a call with a whole response. */
export const respond = (
	call: FakeHttpCall,
	status: number,
	body: string,
	headers: Record<string, string> = {},
) => {
	call.emit({ type: "head", status, url: call.url, headers })
	if (body !== "") call.emit({ type: "chunk", data: new TextEncoder().encode(body) })
	call.emit({ type: "end" })
}

export type { NativeHttpResult }
