/**
 * `WebSocketLike` over `URLSessionWebSocketTask` (`__native.socket`): text and binary frames,
 * subprotocols and close codes, with the browser's `readyState` and `binaryType` behaviour. A binary
 * frame arrives as an `ArrayBuffer` (`binaryType = "arraybuffer"`, the only type a JSContext has).
 */
import type { WebSocketConstructor, WebSocketLike } from "@hazel/effect-db-collection"
import { type NativeBridge, type NativeSocketEvent, nativeBridge } from "./bridge"

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

/** `close` takes 1000 or 3000 to 4999 from a page, as a browser's does. */
const isAllowedCloseCode = (code: number) => code === 1000 || (code >= 3000 && code <= 4999)

export const makeNativeWebSocket = (bridge: () => NativeBridge) =>
	class NativeWebSocket implements WebSocketLike {
		static readonly CONNECTING = CONNECTING
		static readonly OPEN = OPEN
		static readonly CLOSING = CLOSING
		static readonly CLOSED = CLOSED
		readyState = CONNECTING
		onopen: WebSocketLike["onopen"] = null
		onmessage: WebSocketLike["onmessage"] = null
		onclose: WebSocketLike["onclose"] = null
		onerror: WebSocketLike["onerror"] = null
		protocol = ""
		binaryType: "arraybuffer" = "arraybuffer"
		/** Bytes handed to `send` that the host has not reported sent; the host does not say, so 0. */
		readonly bufferedAmount = 0
		private readonly id: number

		constructor(
			readonly url: string,
			protocols: string | Array<string> = [],
		) {
			const list = typeof protocols === "string" ? [protocols] : [...protocols]
			this.id = bridge().socket.open(url, list, (event) => this.receive(event))
		}

		private receive(event: NativeSocketEvent) {
			switch (event.type) {
				case "open":
					if (this.readyState !== CONNECTING) return
					this.readyState = OPEN
					this.protocol = event.protocol
					return this.onopen?.({ type: "open" })
				case "message":
					// A frame after `close()` is dropped, as a browser drops it once closing.
					if (this.readyState === OPEN) this.onmessage?.({ data: event.data })
					return
				case "error":
					if (this.readyState === CLOSED) return
					return this.onerror?.({ type: "error", message: event.message })
				case "close":
					if (this.readyState === CLOSED) return
					this.readyState = CLOSED
					return this.onclose?.({ code: event.code, reason: event.reason })
			}
		}

		send(data: string | ArrayBuffer | ArrayBufferView): void {
			if (this.readyState === CONNECTING)
				throw new Error("InvalidStateError: the socket is still connecting")
			// A browser drops frames sent while closing or closed, without throwing.
			if (this.readyState !== OPEN) return
			const socket = bridge().socket
			if (typeof data === "string") return socket.send(this.id, data)
			if (socket.binary !== true) throw new Error("The host's sockets take text frames only")
			const bytes =
				data instanceof ArrayBuffer
					? new Uint8Array(data)
					: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
			socket.send(this.id, bytes)
		}

		close(code?: number, reason = ""): void {
			if (code !== undefined && !isAllowedCloseCode(code))
				throw new Error(`InvalidAccessError: close code ${code} is not allowed`)
			if (this.readyState === CLOSING || this.readyState === CLOSED) return
			this.readyState = CLOSING
			bridge().socket.close(this.id, code ?? 1000, reason)
		}
	}

/** The sockets over the installed bridge. */
export const NativeWebSocket: WebSocketConstructor = makeNativeWebSocket(nativeBridge)
