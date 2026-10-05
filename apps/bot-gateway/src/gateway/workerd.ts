/**
 * The few workerd WebSocket APIs the gateway Worker uses, typed locally so this package keeps
 * compiling under Bun's ambient types (the Bun gateway in `src/index.ts` shares the tsconfig).
 */
import type { Handshake } from "./handshake.ts"
import { encodeHandshake } from "./handshake.ts"
import type { RelaySocket, UpstreamResult } from "./relay.ts"

export interface WorkerdWebSocket {
	accept(): void
	send(data: string): void
	close(code?: number, reason?: string): void
	addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
	addEventListener(
		type: "close",
		listener: (event: { readonly code: number; readonly reason: string }) => void,
	): void
	addEventListener(type: "error", listener: (event: unknown) => void): void
}

interface WorkerdResponse {
	readonly status: number
	readonly webSocket?: WorkerdWebSocket | null
	text(): Promise<string>
}

/** A Durable Object namespace binding, as far as the relay uses it. */
export interface WorkerdNamespace {
	getByName(name: string): {
		fetch(input: string, init: { readonly headers: Record<string, string> }): Promise<WorkerdResponse>
	}
}

/** `new WebSocketPair()`: `[client, server]`. */
export const newWebSocketPair = (): readonly [WorkerdWebSocket, WorkerdWebSocket] => {
	const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, WorkerdWebSocket> })
		.WebSocketPair
	const pair = new Pair()
	return [pair[0], pair[1]]
}

/** The 101 response that hands `client` to the caller. */
export const upgradeResponse = (client: WorkerdWebSocket): Response =>
	new Response(null, { status: 101, webSocket: client } as ResponseInit)

const textOf = (data: unknown): string =>
	typeof data === "string"
		? data
		: data instanceof ArrayBuffer
			? new TextDecoder().decode(data)
			: ArrayBuffer.isView(data)
				? new TextDecoder().decode(data)
				: String(data)

/** Adapt an accepted workerd socket to the relay's interface. */
export const relaySocket = (ws: WorkerdWebSocket): RelaySocket => ({
	send: (data) => ws.send(data),
	close: (code, reason) => ws.close(code, reason),
	onMessage: (listener) => ws.addEventListener("message", (event) => listener(textOf(event.data))),
	onClose: (listener) => {
		ws.addEventListener("close", (event) => listener(event.code, event.reason))
		ws.addEventListener("error", () => listener(1011, "websocket_error"))
	},
})

/** Open the bot's session on its `BotGateway` object. */
export const connectToObject = async (
	namespace: WorkerdNamespace,
	handshake: Handshake,
): Promise<UpstreamResult> => {
	const response = await namespace
		.getByName(handshake.botId)
		.fetch("https://bot-gateway.internal/session", {
			headers: { Upgrade: "websocket", ...encodeHandshake(handshake) },
		})
	if (response.status === 101 && response.webSocket) {
		response.webSocket.accept()
		return { _tag: "Connected", socket: relaySocket(response.webSocket) }
	}
	const body = await response.text().catch(() => "")
	if (response.status === 409) {
		const reason = (() => {
			try {
				const parsed = JSON.parse(body) as { reason?: unknown }
				return typeof parsed.reason === "string" ? parsed.reason : undefined
			} catch {
				return undefined
			}
		})()
		return { _tag: "Rejected", reason: reason ?? "session rejected" }
	}
	return {
		_tag: "Unavailable",
		reason: `BotGateway object answered ${response.status}: ${body.slice(0, 200)}`,
	}
}
