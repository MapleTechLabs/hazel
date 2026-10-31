/**
 * `GET /sync/:kind/:id`: what the route forwards (the principal's expiry) and how it closes a
 * socket it cannot serve (4001 for a bad token, 1011 for everything that is not the token's fault).
 */
import { Database } from "@hazel/db"
import { CurrentUser, SessionLoadError } from "@hazel/domain"
import { SYNC_MUX_SUBPROTOCOL, SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import type { UserId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { HttpRouter } from "effect/http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Directory } from "../services/directory"
import { HazelSession, type VerifiedUser } from "../services/hazel-session"
import { decodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER, WARM_HEADER } from "./objects/principal"
import { makeSyncRoute } from "./sync-route"

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
const jwt = "header.payload.signature"

/** Close codes of the sockets `acceptAndClose` made (workerd's `WebSocketPair`, faked). */
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

type Verify = (token: string) => Effect.Effect<Option.Option<VerifiedUser>, unknown>

const build = (options: {
	readonly verify: Verify
	readonly channel?: Directory["Service"]["channel"]
	readonly env: Record<string, unknown>
}) => {
	const session = Layer.succeed(HazelSession, {
		verifyAccessTokenWithExpiry: options.verify,
		verifyWithExpiry: options.verify,
	} as never)
	const directory = Layer.succeed(Directory, {
		channel: options.channel ?? (() => Effect.succeed(Option.none())),
	} as never)
	const web = HttpRouter.toWebHandler(
		makeSyncRoute(options.env).pipe(Layer.provide(Layer.mergeAll(session, directory))),
		{ disableLogger: true },
	)
	const handler = web.handler as (request: Request) => Promise<Response>
	return Object.assign(
		(path: string) =>
			handler(
				new Request(`http://api.test${path}`, {
					headers: {
						upgrade: "websocket",
						"sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, ${jwt}`,
					},
				}),
			),
		{
			/** `GET /sync/mux`, offering `protocols`. */
			mux: (protocols: string) =>
				handler(
					new Request("http://api.test/sync/mux", {
						headers: { upgrade: "websocket", "sec-websocket-protocol": protocols },
					}),
				),
			/** `POST /sync/warm`, with `token` as the bearer (`null`: none). */
			warm: (query: string, token: string | null = jwt) =>
				handler(
					new Request(`http://api.test/sync/warm${query}`, {
						method: "POST",
						headers: token === null ? {} : { authorization: `Bearer ${token}` },
					}),
				),
		},
	)
}

/** A namespace that records which object names it was asked to wake. */
const warmNamespace = () => {
	const woken: Array<string> = []
	return {
		woken,
		namespace: {
			getByName: (name: string) => ({
				fetch: (request: Request) => {
					expect(request.headers.get(WARM_HEADER)).toBe("1")
					woken.push(name)
					return Promise.resolve(new Response(null, { status: 204 }))
				},
			}),
		},
	}
}

/** An `OrgObject` namespace that records what it was forwarded. */
const recordingNamespace = () => {
	const forwarded: Array<Request> = []
	return {
		forwarded,
		namespace: {
			getByName: () => ({
				fetch: (request: Request) => {
					forwarded.push(request)
					return Promise.resolve(new Response("upgraded"))
				},
			}),
		},
	}
}

describe("multiplexed sync socket", () => {
	it("closes a bad or missing token with 4001, echoing the mux subprotocol", async () => {
		const send = build({ verify: () => Effect.succeed(Option.none()), env: {} })
		const response = await send.mux(`${SYNC_MUX_SUBPROTOCOL}, ${jwt}`)
		expect(response.headers.get("sec-websocket-protocol")).toBe(SYNC_MUX_SUBPROTOCOL)
		await send.mux(`${SYNC_SUBPROTOCOL}, ${jwt}`)
		expect(closed).toEqual([
			{ code: SyncCloseCode.Reauth, reason: "invalid_token" },
			{ code: SyncCloseCode.Reauth, reason: "missing_token" },
		])
	})

	it("closes with 1011 (not 4001) when the session store is down", async () => {
		const send = build({
			verify: () => Effect.fail(new SessionLoadError({ message: "down", detail: "db" })),
			env: {},
		})
		await send.mux(`${SYNC_MUX_SUBPROTOCOL}, ${jwt}`)
		expect(closed).toEqual([{ code: 1011, reason: "unavailable" }])
	})
})

describe("sync route", () => {
	it("forwards the credential's expiry as the principal's expiresAt", async () => {
		const expiresAt = Date.now() + 300_000
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: () => Effect.succeed(Option.some({ user, expiresAt })),
			env: { OrgObject: namespace },
		})
		const response = await send("/sync/org/org-1")
		expect(await response.text()).toBe("upgraded")
		expect(forwarded).toHaveLength(1)
		const principal = decodeSyncPrincipal(forwarded[0]!.headers.get(PRINCIPAL_HEADER) ?? "")
		expect(Option.getOrThrow(principal)).toEqual({ userId, expiresAt })
		expect(forwarded[0]!.headers.get(OBJECT_ID_HEADER)).toBe("org-1")
	})

	it("closes a bad token with 4001, so the client fetches a fresh one", async () => {
		const send = build({ verify: () => Effect.succeed(Option.none()), env: {} })
		await send("/sync/org/org-1")
		expect(closed).toEqual([{ code: SyncCloseCode.Reauth, reason: "invalid_token" }])
	})

	it("closes with 1011 (not 4001) when the session store is down", async () => {
		const send = build({
			verify: () => Effect.fail(new SessionLoadError({ message: "down", detail: "db" })),
			env: {},
		})
		await send("/sync/org/org-1")
		expect(closed).toEqual([{ code: 1011, reason: "unavailable" }])
	})

	it("closes with 1011 when the directory, the binding or the object fails", async () => {
		const verify: Verify = () => Effect.succeed(Option.some({ user, expiresAt: Date.now() + 60_000 }))
		const { namespace } = recordingNamespace()

		const directoryDown = build({
			verify,
			channel: () =>
				Effect.fail(
					new Database.DatabaseError({ type: "connection_error", message: "D1 down", cause: null }),
				),
			env: { ChannelObject: namespace },
		})
		await directoryDown(`/sync/channel/${crypto.randomUUID()}`)

		const unbound = build({ verify, env: {} })
		await unbound("/sync/user/u-1")

		const unreachable = build({
			verify,
			env: {
				UserObject: {
					getByName: () => ({ fetch: () => Promise.reject(new Error("reset")) }),
				},
			},
		})
		await unreachable("/sync/user/u-1")

		expect(closed).toEqual([
			{ code: 1011, reason: "unavailable" },
			{ code: 1011, reason: "unavailable" },
			{ code: 1011, reason: "unavailable" },
		])
	})
})

describe("sync warm-up", () => {
	const verify: Verify = () => Effect.succeed(Option.some({ user, expiresAt: Date.now() + 60_000 }))
	const channelId = crypto.randomUUID()
	const hostChannelId = crypto.randomUUID()

	it("wakes the caller's user object and the channel the directory knows, by its host", async () => {
		const users = warmNamespace()
		const channels = warmNamespace()
		const send = build({
			verify,
			channel: () =>
				Effect.succeed(Option.some({ channelId, hostChannelId, deletedAt: null } as never)),
			env: { UserObject: users.namespace, ChannelObject: channels.namespace },
		})
		const response = await send.warm(`?channel=${channelId}`)
		expect(response.status).toBe(204)
		expect(users.woken).toEqual([userId])
		expect(channels.woken).toEqual([hostChannelId])
	})

	it("never wakes a channel the directory does not know, or a deleted one", async () => {
		const channels = warmNamespace()
		const unknown = build({
			verify,
			env: { UserObject: warmNamespace().namespace, ChannelObject: channels.namespace },
		})
		await unknown.warm(`?channel=${channelId}`)
		await unknown.warm("?channel=not-a-uuid")
		const deleted = build({
			verify,
			channel: () =>
				Effect.succeed(
					Option.some({ channelId, hostChannelId: null, deletedAt: new Date() } as never),
				),
			env: { UserObject: warmNamespace().namespace, ChannelObject: channels.namespace },
		})
		await deleted.warm(`?channel=${channelId}`)
		expect(channels.woken).toEqual([])
	})

	it("refuses a missing or invalid token, and wakes nothing", async () => {
		const users = warmNamespace()
		const refused = build({
			verify: () => Effect.succeed(Option.none()),
			env: { UserObject: users.namespace },
		})
		expect((await refused.warm("")).status).toBe(401)
		expect((await refused.warm("", null)).status).toBe(401)
		expect((await refused.warm("", "not-a-jwt")).status).toBe(401)
		expect(users.woken).toEqual([])
	})

	it("still answers when an object cannot be reached", async () => {
		const send = build({
			verify,
			env: { UserObject: { getByName: () => ({ fetch: () => Promise.reject(new Error("reset")) }) } },
		})
		expect((await send.warm("")).status).toBe(204)
	})
})
