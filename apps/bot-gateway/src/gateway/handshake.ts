/**
 * The internal handshake from the gateway Worker to a `BotGateway` object. Bots send their token
 * inside the first WebSocket frame (IDENTIFY/RESUME), not on the upgrade request, so the Worker
 * accepts the socket, authenticates that frame, and only then opens a WebSocket to the bot's
 * object, describing the session in these headers. The object is reachable only through its
 * namespace binding, so it can trust them.
 */
import type { SessionRequest } from "./log.ts"

export const HANDSHAKE_HEADERS = {
	botId: "x-hazel-bot-id",
	botName: "x-hazel-bot-name",
	op: "x-hazel-gateway-op",
	sessionId: "x-hazel-gateway-session-id",
	resumeOffset: "x-hazel-gateway-resume-offset",
} as const

export interface Handshake {
	readonly botId: string
	readonly botName: string
	readonly request: SessionRequest
}

export const encodeHandshake = (handshake: Handshake): Record<string, string> => ({
	[HANDSHAKE_HEADERS.botId]: handshake.botId,
	// Header values must be ByteStrings; bot names are free text.
	[HANDSHAKE_HEADERS.botName]: encodeURIComponent(handshake.botName),
	[HANDSHAKE_HEADERS.op]: handshake.request.op,
	[HANDSHAKE_HEADERS.resumeOffset]: encodeURIComponent(handshake.request.resumeOffset),
	...(handshake.request.op === "RESUME"
		? { [HANDSHAKE_HEADERS.sessionId]: handshake.request.sessionId }
		: {}),
})

const safeDecode = (value: string): string | undefined => {
	try {
		return decodeURIComponent(value)
	} catch {
		return undefined
	}
}

/** The handshake from request headers (lower-cased keys), or `undefined` if malformed. */
export const decodeHandshake = (
	headers: Readonly<Record<string, string | undefined>>,
): Handshake | undefined => {
	const botId = headers[HANDSHAKE_HEADERS.botId]
	const botName = safeDecode(headers[HANDSHAKE_HEADERS.botName] ?? "")
	const op = headers[HANDSHAKE_HEADERS.op]
	const resumeOffset = safeDecode(headers[HANDSHAKE_HEADERS.resumeOffset] ?? "")
	if (!botId || botName === undefined || resumeOffset === undefined) return undefined
	if (op === "IDENTIFY") return { botId, botName, request: { op, resumeOffset } }
	const sessionId = headers[HANDSHAKE_HEADERS.sessionId]
	if (op === "RESUME" && sessionId) return { botId, botName, request: { op, sessionId, resumeOffset } }
	return undefined
}
