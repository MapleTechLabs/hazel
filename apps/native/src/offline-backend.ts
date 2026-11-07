import { HazelAuthApi } from "@hazel/auth/contract"
import * as DomainRpc from "@hazel/domain/rpc"
import { Schema } from "effect"
import * as CurrentUser from "../../../packages/domain/src/current-user"
import type { FixtureServer } from "./fixture/fixture-socket"
import { generalMessageRows, presenceRows } from "./fixture/snapshot"

/**
 * The few HTTP calls the app makes outside the sync socket, answered locally: the session check,
 * the sync access token and `/rpc`. Everything else in the app runs as it does against the API.
 */
/** An idle RPC's encoded success value. */
type Responder = (payload: Record<string, unknown>) => Schema.Json | object

export const makeOfflineFetch = (options: {
	readonly backendUrl: string
	readonly user: CurrentUser.Schema
	readonly onUnknownRpc?: (tag: string) => void
	/** Where writes go: a sent message streams back to the channel's subscribers. */
	readonly server?: FixtureServer
}): typeof fetch => {
	const now = Date.now()
	const session: typeof HazelAuthApi.sessions.Session.Type = Schema.decodeUnknownSync(
		HazelAuthApi.sessions.Session,
	)({
		sessionId: "offline-session",
		subjectId: options.user.id,
		securityRevision: "1",
		assurance: { method: "oauth", factors: [], authenticatedAt: now },
		issuedAt: now,
		expiresAt: now + 86_400_000,
		absoluteExpiresAt: now + 86_400_000,
		claims: { displayName: `${options.user.firstName ?? ""} ${options.user.lastName ?? ""}`.trim() },
	})
	const encodedSession = Schema.encodeSync(Schema.toCodecJson(HazelAuthApi.sessions.Session))(session)
	const encodedUser = Schema.encodeSync(Schema.toCodecJson(CurrentUser.Schema))(options.user)
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })

	// Domain RPC success schemas decode without services.
	const rpcs = new Map<string, { readonly successSchema: Schema.Codec<unknown> }>()
	for (const group of Object.values(DomainRpc)) {
		const requests = (group as { requests?: unknown }).requests
		if (requests instanceof Map) for (const [tag, rpc] of requests) rpcs.set(tag, rpc)
	}
	const presence = presenceRows.find((row) => row.userId === options.user.id)
	/** Encoded success values for the RPCs the app calls on its own while idle. */
	const responders = new Map<string, Responder>([
		["user.me", () => encodedUser],
		["channelMember.clearNotifications", () => ({ transactionId: crypto.randomUUID() })],
		["userPresenceStatus.heartbeat", () => ({ lastSeenAt: new Date().toISOString() })],
		// A sent message is stored as the fixture stores its own: a full row, with this payload's content.
		[
			"message.create",
			(payload) => {
				const row = {
					...generalMessageRows[0],
					...payload,
					id: crypto.randomUUID(),
					authorId: options.user.id,
					createdAt: new Date().toISOString(),
					updatedAt: null,
					deletedAt: null,
				}
				const channelId = String(payload.channelId)
				const transactionId =
					options.server?.write("channel", channelId, "messages", [row]) ?? `channel:${channelId}:1`
				return { data: row, transactionId }
			},
		],
		[
			"userPresenceStatus.update",
			(payload) => ({
				data: { ...presence, ...payload, updatedAt: new Date().toISOString() },
				transactionId: crypto.randomUUID(),
			}),
		],
	])

	/**
	 * Any other RPC: the first plausible answer its success schema accepts (nothing, a transaction
	 * id, or the payload echoed back as the stored row), else its typed `InternalServerError`.
	 */
	const answerFromSchema = (tag: string, payload: Record<string, unknown>) => {
		const rpc = rpcs.get(tag)
		if (rpc === undefined) return undefined
		const nowIso = new Date().toISOString()
		const row = {
			id: crypto.randomUUID(),
			createdAt: nowIso,
			updatedAt: nowIso,
			deletedAt: null,
			authorId: options.user.id,
			userId: options.user.id,
			...payload,
		}
		const candidates = [
			null,
			{ transactionId: crypto.randomUUID() },
			{ data: row, transactionId: crypto.randomUUID() },
		]
		const codec = Schema.toCodecJson(rpc.successSchema)
		return candidates.find((candidate) => Schema.decodeUnknownExit(codec)(candidate)._tag === "Success")
	}

	const answerRpc = (line: string): string => {
		// SAFETY: the app's own RPC client writes these request frames.
		const request = JSON.parse(line) as {
			_tag: string
			id: string | number
			tag: string
			payload: unknown
		}
		if (request._tag !== "Request") return ""
		const payload = (
			typeof request.payload === "object" && request.payload !== null ? request.payload : {}
		) as Record<string, unknown>
		const respond = responders.get(request.tag)
		const value = respond === undefined ? answerFromSchema(request.tag, payload) : respond(payload)
		const exit =
			value === undefined
				? {
						_tag: "Failure",
						cause: [
							{
								_tag: "Fail",
								error: { _tag: "InternalServerError", message: "Not available offline" },
							},
						],
					}
				: { _tag: "Success", value }
		if (value === undefined) options.onUnknownRpc?.(request.tag)
		return `${JSON.stringify({ _tag: "Exit", requestId: request.id, exit })}\n`
	}

	const offlineFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init)
		const url = new URL(request.url)
		if (process.env.NATIVE_DEBUG) process.stderr.write(`[offline] ${request.method} ${url.pathname}\n`)
		if (!request.url.startsWith(options.backendUrl)) return new Response(null, { status: 404 })
		switch (url.pathname.replace(/\/$/, "")) {
			case "/auth/getSession":
				return json({ _tag: "Success", value: encodedSession })
			case "/auth/token":
				return json({ token: "offline", expiresIn: 3600 })
			case "/rpc": {
				const body = await request.text()
				const lines = body.split("\n").filter((line) => line.trim() !== "")
				return new Response(lines.map(answerRpc).join(""), {
					headers: { "content-type": "application/ndjson" },
				})
			}
			default:
				return new Response(null, { status: 404 })
		}
	}
	return offlineFetch
}
