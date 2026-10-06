/**
 * The gateway Worker's side of a bot connection. The protocol puts the bot token in the first
 * frame, so the bot's `BotGateway` object is unknown until that frame is authenticated: the
 * Worker therefore terminates the bot's WebSocket itself and relays frames to a second WebSocket
 * it opens to the object once the bot is known.
 *
 * The Worker also answers HEARTBEAT frames itself, so a quiet bot never wakes its (hibernated)
 * object, and closes a client that stays silent for the lease TTL. That close is what frees the
 * bot for a new session, the role the Redis lease TTL used to play.
 *
 * Plain callbacks over a minimal socket interface, so the state machine tests without workerd.
 */
import {
	BotGatewayClientFrame,
	type BotGatewayHeartbeatAckFrame,
	type BotGatewayHelloFrame,
	type BotGatewayInvalidSessionFrame,
	type BotGatewayReconnectFrame,
} from "@hazel/domain"
import { Option, Schema } from "effect"
import type { Handshake } from "./handshake.ts"
import type { SessionRequest } from "./log.ts"

export interface RelaySocket {
	send(data: string): void
	close(code: number, reason: string): void
	onMessage(listener: (data: string) => void): void
	onClose(listener: (code: number, reason: string) => void): void
}

export type AuthResult =
	| { readonly _tag: "Authenticated"; readonly botId: string; readonly botName: string }
	| { readonly _tag: "Rejected"; readonly reason: string }
	| { readonly _tag: "Unavailable"; readonly reason: string }

export type UpstreamResult =
	| { readonly _tag: "Connected"; readonly socket: RelaySocket }
	| { readonly _tag: "Rejected"; readonly reason: string }
	| { readonly _tag: "Unavailable"; readonly reason: string }

export interface RelayClock {
	readonly now: () => number
	readonly setInterval: (fn: () => void, ms: number) => unknown
	readonly clearInterval: (handle: unknown) => void
}

const systemClock: RelayClock = {
	now: () => Date.now(),
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

export interface RelayOptions {
	readonly client: RelaySocket
	readonly heartbeatIntervalMs: number
	readonly leaseTtlMs: number
	readonly authenticate: (botToken: string) => Promise<AuthResult>
	readonly connect: (handshake: Handshake) => Promise<UpstreamResult>
	readonly clock?: RelayClock
	readonly log?: (message: string, fields?: Record<string, unknown>) => void
}

export type RelayPhase = "awaiting_identify" | "authenticating" | "relaying" | "closed"

export interface RelayHandle {
	readonly phase: () => RelayPhase
}

/** Codes a server may send in a close frame; anything else (1005, 1006, ...) becomes 1012. */
export const relayCloseCode = (code: number): number =>
	code === 1000 ||
	(code >= 1001 && code <= 1003) ||
	(code >= 1007 && code <= 1014) ||
	(code >= 3000 && code <= 4999)
		? code
		: 1012

const decodeClientFrame = Schema.decodeUnknownOption(BotGatewayClientFrame)

const parseClientFrame = (data: string): BotGatewayClientFrame | undefined => {
	try {
		return Option.getOrUndefined(decodeClientFrame(JSON.parse(data)))
	} catch {
		return undefined
	}
}

const hello = (heartbeatIntervalMs: number): typeof BotGatewayHelloFrame.Type => ({
	op: "HELLO",
	heartbeatIntervalMs,
})

export const startRelay = (options: RelayOptions): RelayHandle => {
	const { client } = options
	const clock = options.clock ?? systemClock
	const log = options.log ?? (() => undefined)

	let phase: RelayPhase = "awaiting_identify"
	let upstream: RelaySocket | undefined
	let lastActivity = clock.now()
	const buffered: Array<string> = []
	// A function, so checks after an `await` are not narrowed away.
	const isClosed = () => phase === "closed"

	const send = (frame: object) => {
		try {
			client.send(JSON.stringify(frame))
		} catch {
			// The client is gone; its close listener finishes the teardown.
		}
	}

	const closeSocket = (socket: RelaySocket | undefined, code: number, reason: string) => {
		try {
			socket?.close(relayCloseCode(code), reason.slice(0, 120))
		} catch {
			// Already closed.
		}
	}

	const shutdown = (code: number, reason: string) => {
		if (phase === "closed") return
		phase = "closed"
		clock.clearInterval(watchdog)
		closeSocket(upstream, code, reason)
		closeSocket(client, code, reason)
	}

	const invalidSession = (reason: string) => {
		send({ op: "INVALID_SESSION", reason } satisfies typeof BotGatewayInvalidSessionFrame.Type)
		shutdown(1008, reason)
	}

	const reconnect = (reason: string) => {
		send({ op: "RECONNECT", reason } satisfies typeof BotGatewayReconnectFrame.Type)
		shutdown(1012, reason)
	}

	const watchdog = clock.setInterval(
		() => {
			if (phase !== "closed" && clock.now() - lastActivity > options.leaseTtlMs) {
				log("Bot gateway client heartbeat timed out", { leaseTtlMs: options.leaseTtlMs })
				shutdown(1001, "heartbeat_timeout")
			}
		},
		Math.max(1_000, Math.min(options.heartbeatIntervalMs, options.leaseTtlMs)),
	)

	const attachUpstream = (socket: RelaySocket) => {
		upstream = socket
		phase = "relaying"
		socket.onMessage((data) => {
			if (phase !== "closed") {
				try {
					client.send(data)
				} catch {
					// The client is gone; its close listener finishes the teardown.
				}
			}
		})
		socket.onClose((code, reason) => shutdown(code, reason || "gateway_session_closed"))
		for (const data of buffered.splice(0)) socket.send(data)
	}

	const identify = async (botToken: string, request: SessionRequest) => {
		const auth = await options
			.authenticate(botToken)
			.catch((cause): AuthResult => ({ _tag: "Unavailable", reason: `auth failed: ${String(cause)}` }))
		if (isClosed()) return
		if (auth._tag === "Rejected") return invalidSession(auth.reason)
		if (auth._tag === "Unavailable") {
			log("Bot gateway authentication unavailable", { reason: auth.reason })
			return reconnect("gateway_unavailable")
		}

		const result = await options
			.connect({ botId: auth.botId, botName: auth.botName, request })
			.catch((cause): UpstreamResult => ({ _tag: "Unavailable", reason: String(cause) }))
		if (isClosed()) {
			if (result._tag === "Connected") closeSocket(result.socket, 1000, "client_closed")
			return
		}
		switch (result._tag) {
			case "Connected":
				return attachUpstream(result.socket)
			case "Rejected":
				return invalidSession(result.reason)
			case "Unavailable":
				log("Bot gateway session unavailable", { botId: auth.botId, reason: result.reason })
				return reconnect("gateway_unavailable")
		}
	}

	client.onMessage((data) => {
		if (phase === "closed") return
		lastActivity = clock.now()
		const frame = parseClientFrame(data)
		if (frame === undefined) return invalidSession("Failed to decode gateway frame")

		switch (frame.op) {
			case "HEARTBEAT": {
				send({
					op: "HEARTBEAT_ACK",
					sessionId: frame.sessionId,
				} satisfies typeof BotGatewayHeartbeatAckFrame.Type)
				return
			}
			case "IDENTIFY":
			case "RESUME": {
				// A repeat while authenticating is dropped; after READY the session is already
				// identified (the lease rejected a second identify the same way).
				if (phase === "authenticating") return
				if (phase === "relaying") return invalidSession("session already identified")
				phase = "authenticating"
				const request: SessionRequest =
					frame.op === "IDENTIFY"
						? { op: "IDENTIFY", resumeOffset: frame.resumeOffset }
						: { op: "RESUME", sessionId: frame.sessionId, resumeOffset: frame.resumeOffset }
				void identify(frame.botToken, request)
				return
			}
			case "ACK": {
				// Nothing can be acknowledged before the session is READY.
				if (phase === "awaiting_identify") return
				break
			}
		}
		// Post-identify frames belong to the bot's object.
		if (phase === "relaying" && upstream !== undefined) upstream.send(data)
		else buffered.push(data)
	})

	client.onClose(() => shutdown(1000, "client_closed"))

	send(hello(options.heartbeatIntervalMs))

	return { phase: () => phase }
}
