/**
 * The internal handshake from the gateway Worker to a `BotGateway` object. Bots send their token
 * inside the first WebSocket frame (IDENTIFY/RESUME), not on the upgrade request, so the Worker
 * accepts the socket, authenticates that frame, and only then opens a WebSocket to the bot's
 * object, describing the session in these headers. The object is reachable only through its
 * namespace binding, so it can trust them.
 */
import { BOT_GATEWAY_REGION_PATTERN } from "@hazel/domain"
import type { SessionRequest } from "./log.ts"

export const HANDSHAKE_HEADERS = {
	botId: "x-hazel-bot-id",
	botUserId: "x-hazel-bot-user-id",
	botName: "x-hazel-bot-name",
	op: "x-hazel-gateway-op",
	sessionId: "x-hazel-gateway-session-id",
	resumeOffset: "x-hazel-gateway-resume-offset",
	region: "x-hazel-gateway-region",
} as const

export interface Handshake {
	readonly botId: string
	/** The bot's user, for READY. Optional: a Worker deployed before it sends none. */
	readonly botUserId?: string | undefined
	readonly botName: string
	readonly request: SessionRequest
	/** The region the session serves (`BotGatewayRegion`, already validated); omitted for the default. */
	readonly region?: string | undefined
}

export const encodeHandshake = (handshake: Handshake): Record<string, string> => ({
	[HANDSHAKE_HEADERS.botId]: handshake.botId,
	...(handshake.botUserId === undefined ? {} : { [HANDSHAKE_HEADERS.botUserId]: handshake.botUserId }),
	// Header values must be ByteStrings; bot names are free text.
	[HANDSHAKE_HEADERS.botName]: encodeURIComponent(handshake.botName),
	[HANDSHAKE_HEADERS.op]: handshake.request.op,
	[HANDSHAKE_HEADERS.resumeOffset]: encodeURIComponent(handshake.request.resumeOffset),
	...(handshake.request.op === "RESUME"
		? { [HANDSHAKE_HEADERS.sessionId]: handshake.request.sessionId }
		: {}),
	...(handshake.region === undefined ? {} : { [HANDSHAKE_HEADERS.region]: handshake.region }),
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
	const botUserId = headers[HANDSHAKE_HEADERS.botUserId] || undefined
	const region = headers[HANDSHAKE_HEADERS.region] || undefined
	if (!botId || botName === undefined || resumeOffset === undefined) return undefined
	if (region !== undefined && !BOT_GATEWAY_REGION_PATTERN.test(region)) return undefined
	if (op === "IDENTIFY") return { botId, botUserId, botName, region, request: { op, resumeOffset } }
	const sessionId = headers[HANDSHAKE_HEADERS.sessionId]
	if (op === "RESUME" && sessionId)
		return { botId, botUserId, botName, region, request: { op, sessionId, resumeOffset } }
	return undefined
}
