/**
 * `GET /live/:messageId?channelId=`: what the route forwards to the `MessageLiveObject` (the
 * principal, the message id, the Connect host channel) and how it closes a socket it cannot serve.
 */
import { CurrentUser } from "@hazel/domain"
import { SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import type { ChannelId, UserId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { HttpRouter } from "effect/http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Directory } from "../services/directory"
import { HazelSession } from "../services/hazel-session"
import { makeLiveRoute } from "./live-route"
import { LIVE_CHANNEL_HEADER } from "./live/runtime"
import { decodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER } from "./objects/principal"

const userId = crypto.randomUUID() as UserId
const user = new CurrentUser.Schema({
	id: userId,
	role: "member",
	organizationId: undefined,
	firstName: "Ada",
	lastName: "L",
	email: "ada@test",
	isOnboarded: true,
	timezone: null,
	settings: null,
} as never)

let closed: Array<{ code: number; reason: string }> = []

beforeEach(() => {
	closed = []
	class FakePair {
		0 = {}
		1 = {
			accept: () => {},
			close: (code: number, reason: string) => void closed.push({ code, reason }),
		}
	}
	// Node's Response refuses status 101; workerd's does not.
	class WorkerdResponse extends Response {
		constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
			super(body, init?.status === 101 ? { ...init, status: 200 } : init)
		}
	}
	vi.stubGlobal("WebSocketPair", FakePair)
	vi.stubGlobal("Response", WorkerdResponse)
})
afterEach(() => vi.unstubAllGlobals())

const build = (options: {
	readonly valid: boolean
	readonly hostChannelId?: ChannelId
	readonly env: Record<string, unknown>
}) => {
	const verify = () =>
		Effect.succeed(options.valid ? Option.some({ user, expiresAt: 1234 }) : Option.none())
	const session = Layer.succeed(HazelSession, {
		verifyAccessTokenWithExpiry: verify,
		verifyWithExpiry: verify,
	} as never)
	const directory = Layer.succeed(Directory, {
		channel: () =>
			Effect.succeed(
				options.hostChannelId === undefined
					? Option.none()
					: Option.some({ hostChannelId: options.hostChannelId }),
			),
	} as never)
	const web = HttpRouter.toWebHandler(
		makeLiveRoute(options.env).pipe(Layer.provide(Layer.mergeAll(session, directory))),
		{ disableLogger: true },
	)
	return (path: string) =>
		(web.handler as (request: Request) => Promise<Response>)(
			new Request(`http://api.test${path}`, {
				headers: { upgrade: "websocket", "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, a.b.c` },
			}),
		)
}

const recordingNamespace = () => {
	const forwarded: Array<{ name: string; request: Request }> = []
	return {
		forwarded,
		namespace: {
			getByName: (name: string) => ({
				fetch: (request: Request) => {
					forwarded.push({ name, request })
					return Promise.resolve(new Response("upgraded"))
				},
			}),
		},
	}
}

describe("live route", () => {
	const messageId = crypto.randomUUID()
	const channelId = crypto.randomUUID()

	it("forwards the principal, the message and the Connect host channel to the message's object", async () => {
		const host = crypto.randomUUID() as ChannelId
		const { forwarded, namespace } = recordingNamespace()
		const send = build({ valid: true, hostChannelId: host, env: { MessageLiveObject: namespace } })
		const response = await send(`/live/${messageId}?channelId=${channelId}`)
		expect(await response.text()).toBe("upgraded")
		expect(forwarded).toHaveLength(1)
		const { name, request } = forwarded[0]!
		expect(name).toBe(messageId)
		expect(Option.getOrThrow(decodeSyncPrincipal(request.headers.get(PRINCIPAL_HEADER) ?? ""))).toEqual({
			userId,
			expiresAt: 1234,
		})
		expect(request.headers.get(OBJECT_ID_HEADER)).toBe(messageId)
		expect(request.headers.get(LIVE_CHANNEL_HEADER)).toBe(host)
	})

	it("closes a bad token with 4001 and an unbound object with 1011", async () => {
		await build({ valid: false, env: {} })(`/live/${messageId}?channelId=${channelId}`)
		await build({ valid: true, env: {} })(`/live/${messageId}?channelId=${channelId}`)
		expect(closed).toEqual([
			{ code: SyncCloseCode.Reauth, reason: "invalid_token" },
			{ code: 1011, reason: "unavailable" },
		])
	})

	it("answers 404 without a channel", async () => {
		const response = await build({ valid: true, env: {} })(`/live/${messageId}`)
		expect(response.status).toBe(404)
	})
})
