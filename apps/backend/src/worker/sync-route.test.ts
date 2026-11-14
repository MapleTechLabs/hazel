/**
 * `GET /sync/:kind/:id`: what the route forwards (the principal's expiry) and how it closes a
 * socket it cannot serve (4001 for a bad token, 1011 for everything that is not the token's fault).
 * `GET /sync/mux`: how often a socket's tokens are verified. `POST /sync/warm`: who may ask, and
 * which objects it wakes.
 */
import { Database } from "@hazel/db"
import { CurrentUser, InvalidBearerTokenError, SessionLoadError } from "@hazel/domain"
import { SYNC_MUX_SUBPROTOCOL, SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import type { OrganizationId, UserId } from "@hazel/schema"
import { ConfigProvider, Context, Effect, Layer, Option, Tracer } from "effect"
import { HttpRouter } from "effect/http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { corsPolicy } from "../lib/cors"
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

/** A socket as the route sees it: what it was sent, and frames the test makes its peer send. */
class FakeSocket extends EventTarget {
	readyState = 1
	readonly sent: Array<string> = []
	accept() {}
	send(data: string) {
		this.sent.push(data)
	}
	close(_code?: number, _reason?: string) {
		this.readyState = 3
	}
	receive(data: string) {
		this.dispatchEvent(new MessageEvent("message", { data }))
	}
}

/** Close codes of the client sockets the route made (workerd's `WebSocketPair`, faked). */
let closed: Array<{ code: number; reason: string }> = []
/** The server ends of those sockets, in order. */
let servers: Array<FakeSocket> = []

beforeEach(() => {
	closed = []
	servers = []
	class ServerSocket extends FakeSocket {
		override close(code = 1000, reason = "") {
			super.close()
			closed.push({ code, reason })
		}
	}
	class FakePair {
		0 = {}
		1 = new ServerSocket()
		constructor() {
			servers.push(this[1])
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
type WebHandler = (request: Request, context?: Context.Context<never>) => Promise<Response>

const flush = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const appOrigin = "https://app-pr-7.hazel.sh"

const build = (options: {
	readonly verify: Verify
	/** The session cookie's user (`HazelSession.fromCookie`); default: no cookie. */
	readonly cookie?: HazelSession["Service"]["fromCookie"]
	readonly channel?: Directory["Service"]["channel"]
	readonly membership?: Directory["Service"]["membership"]
	readonly organizationsOf?: Directory["Service"]["organizationsOf"]
	readonly env: Record<string, unknown>
	/** Spans the route records, by name. */
	readonly spans?: Array<Tracer.Span>
}) => {
	const session = Layer.succeed(HazelSession, {
		verifyAccessTokenWithExpiry: options.verify,
		verifyWithExpiry: options.verify,
		fromCookie: options.cookie ?? (() => Effect.succeed(Option.none())),
	} as never)
	const directory = Layer.succeed(Directory, {
		channel: options.channel ?? (() => Effect.succeed(Option.none())),
		membership: options.membership ?? (() => Effect.succeed(Option.none())),
		organizationsOf: options.organizationsOf ?? (() => Effect.succeed([])),
	} as never)
	const { spans } = options
	// The request's context: a tracer that keeps the spans it makes.
	const tracing =
		spans === undefined
			? undefined
			: Context.make(
					Tracer.Tracer,
					Tracer.make({
						span: (span) => {
							const recorded = new Tracer.NativeSpan(span)
							spans.push(recorded)
							return recorded
						},
					}),
				)
	const web = HttpRouter.toWebHandler(
		makeSyncRoute(options.env).pipe(
			// As `makeRoutes` mounts it: under the api's CORS policy.
			Layer.provide(Layer.unwrap(Effect.map(corsPolicy, HttpRouter.cors))),
			Layer.provide(Layer.mergeAll(session, directory)),
			Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ FRONTEND_URL: appOrigin }))),
		),
		{ disableLogger: true },
	)
	const handler = (request: Request) => (web.handler as WebHandler)(request, tracing)
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
			/** A `/sync/mux` socket opened with `token`: sends `Open`s, reads the control frames back. */
			openMux: async (token: string = jwt) => {
				await handler(
					new Request("http://api.test/sync/mux", {
						headers: {
							upgrade: "websocket",
							"sec-websocket-protocol": `${SYNC_MUX_SUBPROTOCOL}, ${token}`,
						},
					}),
				)
				const client = servers.at(-1)!
				return {
					open: (id: number, source: string, streamToken: string = token) => {
						const [kind, sourceId] = source.split(":")
						client.receive(
							JSON.stringify({ _tag: "Open", id, kind, sourceId, token: streamToken }),
						)
					},
					controls: (): Array<unknown> => client.sent.map((frame) => JSON.parse(frame)),
				}
			},
			/** `POST /sync/warm`, with `token` as the bearer (`null`: none) and any other `headers`. */
			warm: (query: string, token: string | null = jwt, extra: Record<string, string> = {}) => {
				const headers = new Headers(extra)
				if (token !== null) headers.set("authorization", `Bearer ${token}`)
				return handler(new Request(`http://api.test/sync/warm${query}`, { method: "POST", headers }))
			},
		},
	)
}

/** A namespace that records which object names it was asked to wake, and the requests. */
const warmNamespace = () => {
	const woken: Array<string> = []
	const requests: Array<Request> = []
	return {
		woken,
		requests,
		namespace: {
			getByName: (name: string) => ({
				fetch: (request: Request) => {
					expect(request.headers.get(WARM_HEADER)).toBe("1")
					woken.push(name)
					requests.push(request)
					return Promise.resolve(new Response(null, { status: 204 }))
				},
			}),
		},
	}
}

/** An object namespace that records what it was forwarded, and answers with a socket. */
const recordingNamespace = () => {
	const forwarded: Array<Request> = []
	return {
		forwarded,
		namespace: {
			getByName: () => ({
				fetch: (request: Request) => {
					forwarded.push(request)
					return Promise.resolve(
						Object.assign(new Response("upgraded"), { webSocket: new FakeSocket() }),
					)
				},
			}),
		},
	}
}

/** `traceparent` of `span`, as the object's HTTP tracer reads it. */
const traceparentOf = (span: Tracer.Span) => `00-${span.traceId.padStart(32, "0")}-${span.spanId}-01`

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

	it("verifies a token once per socket, however many sources it opens", async () => {
		const verified: Array<string> = []
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: (token) => {
				verified.push(token)
				return Effect.succeed(Option.some({ user, expiresAt: Date.now() + 300_000 }))
			},
			env: { OrgObject: namespace, UserObject: namespace },
		})
		const mux = await send.openMux()
		mux.open(1, "org:org-1")
		mux.open(2, `user:${userId}`)
		mux.open(3, "org:org-2")
		await flush()
		expect(forwarded).toHaveLength(3)
		expect(verified).toEqual([jwt])
		expect(mux.controls()).toEqual([
			{ _tag: "Opened", id: 1 },
			{ _tag: "Opened", id: 2 },
			{ _tag: "Opened", id: 3 },
		])

		// A second socket checks its token itself.
		await send.openMux()
		expect(verified).toEqual([jwt, jwt])
	})

	it("checks a token the socket has not seen once, for the streams opened together with it", async () => {
		const verified: Array<string> = []
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: (token) => {
				verified.push(token)
				return Effect.as(
					Effect.promise(() => flush()),
					Option.some({ user, expiresAt: Date.now() + 300_000 }),
				)
			},
			env: { OrgObject: namespace },
		})
		const mux = await send.openMux()
		const fresh = "fresh.access.token"
		mux.open(1, "org:org-1", fresh)
		mux.open(2, "org:org-2", fresh)
		await flush()
		await flush()
		expect(forwarded).toHaveLength(2)
		expect(verified).toEqual([jwt, fresh])
	})

	it("checks an expired token again, and never caches a refused one", async () => {
		let valid = true
		const verified: Array<string> = []
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: (token) => {
				verified.push(token)
				// Already past its expiry when verified (inside the verifier's clock tolerance).
				return Effect.succeed(
					valid ? Option.some({ user, expiresAt: Date.now() - 1 }) : Option.none(),
				)
			},
			env: { OrgObject: namespace },
		})
		const mux = await send.openMux()
		mux.open(1, "org:org-1")
		await flush()
		expect(verified).toEqual([jwt, jwt])
		expect(forwarded).toHaveLength(1)

		valid = false
		mux.open(2, "org:org-2")
		mux.open(3, "org:org-3")
		await flush()
		expect(forwarded).toHaveLength(1)
		expect(verified).toHaveLength(4)
		expect(mux.controls().slice(1)).toEqual([
			{ _tag: "Closed", id: 2, code: SyncCloseCode.Reauth, reason: "invalid_token" },
			{ _tag: "Closed", id: 3, code: SyncCloseCode.Reauth, reason: "invalid_token" },
		])
	})

	it("refuses a stream opened with another user's token", async () => {
		const other = new CurrentUser.Schema({ ...user, id: crypto.randomUUID() as UserId })
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: (token) =>
				Effect.succeed(
					Option.some({ user: token === jwt ? user : other, expiresAt: Date.now() + 300_000 }),
				),
			env: { OrgObject: namespace },
		})
		const mux = await send.openMux()
		mux.open(1, "org:org-1", "someone.elses.token")
		// Asked twice: the cached check refuses it the same way.
		mux.open(2, "org:org-1", "someone.elses.token")
		await flush()
		expect(forwarded).toEqual([])
		expect(mux.controls()).toEqual([
			{ _tag: "Closed", id: 1, code: SyncCloseCode.Forbidden, reason: "wrong_user" },
			{ _tag: "Closed", id: 2, code: SyncCloseCode.Forbidden, reason: "wrong_user" },
		])
	})

	it("forwards each stream's span to its object as traceparent", async () => {
		const spans: Array<Tracer.Span> = []
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: () => Effect.succeed(Option.some({ user, expiresAt: Date.now() + 300_000 })),
			env: { OrgObject: namespace },
			spans,
		})
		const mux = await send.openMux()
		mux.open(1, "org:org-1")
		await flush()
		const forward = spans.find((span) => span.name === "SyncRoute.forward")!
		expect(forwarded[0]!.headers.get("traceparent")).toBe(traceparentOf(forward))
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

	it("forwards its span as traceparent, so the object's spans are its children", async () => {
		const spans: Array<Tracer.Span> = []
		const { forwarded, namespace } = recordingNamespace()
		const send = build({
			verify: () => Effect.succeed(Option.some({ user, expiresAt: Date.now() + 300_000 })),
			env: { OrgObject: namespace },
			spans,
		})
		await send("/sync/org/org-1")
		const forward = spans.find((span) => span.name === "SyncRoute.forward")!
		expect(forwarded[0]!.headers.get("traceparent")).toBe(traceparentOf(forward))
		// The upgrade's own headers still reach the object.
		expect(forwarded[0]!.headers.get("upgrade")).toBe("websocket")
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

describe("customers sync", () => {
	const verify: Verify = () => Effect.succeed(Option.some({ user, expiresAt: Date.now() + 60_000 }))
	const orgId = crypto.randomUUID()

	it("opens a member's socket, and refuses a stranger, a former member or an invalid id unwoken", async () => {
		const member = recordingNamespace()
		await build({
			verify,
			membership: () => Effect.succeed(Option.some({ deletedAt: null } as never)),
			env: { CustomersObject: member.namespace },
		})(`/sync/customers/${orgId}`)
		expect(member.forwarded).toHaveLength(1)

		const { forwarded, namespace } = recordingNamespace()
		await build({ verify, env: { CustomersObject: namespace } })(`/sync/customers/${orgId}`)
		await build({
			verify,
			membership: () => Effect.succeed(Option.some({ deletedAt: new Date() } as never)),
			env: { CustomersObject: namespace },
		})(`/sync/customers/${orgId}`)
		await build({
			verify,
			membership: () => Effect.succeed(Option.some({ deletedAt: null } as never)),
			env: { CustomersObject: namespace },
		})("/sync/customers/not-an-org")
		expect(forwarded).toEqual([])
		expect(closed).toEqual([
			{ code: SyncCloseCode.Forbidden, reason: "not_a_member" },
			{ code: SyncCloseCode.Forbidden, reason: "not_a_member" },
			{ code: SyncCloseCode.Forbidden, reason: "not_a_member" },
		])
	})

	it("closes with 1011 when the membership cannot be checked", async () => {
		await build({
			verify,
			membership: () =>
				Effect.fail(
					new Database.DatabaseError({ type: "connection_error", message: "D1 down", cause: null }),
				),
			env: {},
		})(`/sync/customers/${orgId}`)
		expect(closed).toEqual([{ code: 1011, reason: "unavailable" }])
	})
})

describe("sync warm-up", () => {
	const verify: Verify = () => Effect.succeed(Option.some({ user, expiresAt: Date.now() + 60_000 }))
	const channelId = crypto.randomUUID()
	const hostChannelId = crypto.randomUUID()
	const channelRow = (id: string, host: string | null = null, deletedAt: Date | null = null) =>
		Option.some({ channelId: id, hostChannelId: host, deletedAt } as never)

	it("wakes the caller's user object and the channel the directory knows, by its host", async () => {
		const users = warmNamespace()
		const channels = warmNamespace()
		const send = build({
			verify,
			channel: () => Effect.succeed(channelRow(channelId, hostChannelId)),
			env: { UserObject: users.namespace, ChannelObject: channels.namespace },
		})
		const response = await send.warm(`?channel=${channelId}`)
		expect(response.status).toBe(204)
		expect(users.woken).toEqual([userId])
		expect(channels.woken).toEqual([hostChannelId])
	})

	it("wakes every channel asked for, up to eight", async () => {
		const channels = warmNamespace()
		const looked: Array<string> = []
		const ids = Array.from({ length: 10 }, () => crypto.randomUUID())
		const send = build({
			verify,
			channel: (id) => {
				looked.push(id)
				return Effect.succeed(channelRow(id))
			},
			env: { UserObject: warmNamespace().namespace, ChannelObject: channels.namespace },
		})
		// A repeated id is looked up once.
		const query = [ids[0], ...ids].map((id) => `channel=${id}`).join("&")
		expect((await send.warm(`?${query}`)).status).toBe(204)
		expect(looked).toEqual(ids.slice(0, 7))
		expect(channels.woken.toSorted()).toEqual(ids.slice(0, 7).toSorted())
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
			channel: () => Effect.succeed(channelRow(channelId, null, new Date())),
			env: { UserObject: warmNamespace().namespace, ChannelObject: channels.namespace },
		})
		await deleted.warm(`?channel=${channelId}`)
		expect(channels.woken).toEqual([])
	})

	it("wakes the orgs the caller is a member of, from one membership lookup", async () => {
		const orgs = warmNamespace()
		const [own, alsoOwn, foreign] = [1, 2, 3].map(() => crypto.randomUUID() as OrganizationId)
		const lookups: Array<string> = []
		const send = build({
			verify,
			organizationsOf: (id) => {
				lookups.push(id)
				return Effect.succeed([own!, alsoOwn!])
			},
			env: { UserObject: warmNamespace().namespace, OrgObject: orgs.namespace },
		})
		const response = await send.warm(`?org=${own}&org=${foreign}&org=not-an-org&org=${alsoOwn}`)
		expect(response.status).toBe(204)
		expect(orgs.woken.toSorted()).toEqual([own, alsoOwn].toSorted())
		expect(lookups).toEqual([userId])

		// No org asked for: no lookup.
		await send.warm("")
		expect(lookups).toEqual([userId])
	})

	it("wakes no org when the membership cannot be read, and still answers", async () => {
		const orgs = warmNamespace()
		const users = warmNamespace()
		const send = build({
			verify,
			organizationsOf: () =>
				Effect.fail(
					new Database.DatabaseError({ type: "connection_error", message: "D1 down", cause: null }),
				),
			env: { UserObject: users.namespace, OrgObject: orgs.namespace },
		})
		expect((await send.warm(`?org=${crypto.randomUUID()}`)).status).toBe(204)
		expect(orgs.woken).toEqual([])
		expect(users.woken).toEqual([userId])
	})

	it("wakes the user object without waiting for the directory", async () => {
		const users = warmNamespace()
		const channels = warmNamespace()
		const send = build({
			verify,
			// Answers only once the user object was asked to wake.
			channel: (id) =>
				Effect.promise(async () => {
					while (users.woken.length === 0) await flush()
					return channelRow(id)
				}),
			env: { UserObject: users.namespace, ChannelObject: channels.namespace },
		})
		expect((await send.warm(`?channel=${channelId}`)).status).toBe(204)
		expect(channels.woken).toEqual([channelId])
	})

	it("takes a session credential as the bearer", async () => {
		const users = warmNamespace()
		const send = build({ verify, env: { UserObject: users.namespace } })
		expect((await send.warm("", "an-opaque-session-credential")).status).toBe(204)
		expect(users.woken).toEqual([userId])
	})

	it("takes the session cookie alone, and answers with the credentialed CORS headers", async () => {
		const users = warmNamespace()
		const seen: Array<string> = []
		const send = build({
			verify: () => Effect.succeed(Option.none()),
			cookie: (headers, method) => {
				seen.push(`${method} ${headers.origin}`)
				return Effect.succeed(Option.some(user))
			},
			env: { UserObject: users.namespace },
		})
		// A CORS simple request: no custom header, so no preflight.
		const response = await send.warm("", null, { origin: appOrigin, cookie: "session=1" })
		expect(response.status).toBe(204)
		expect(users.woken).toEqual([userId])
		expect(seen).toEqual([`POST ${appOrigin}`])
		expect(response.headers.get("access-control-allow-origin")).toBe(appOrigin)
		expect(response.headers.get("access-control-allow-credentials")).toBe("true")
	})

	it("refuses a cookie the session refuses, and answers 503 when the store is down", async () => {
		const users = warmNamespace()
		const refused = build({
			verify,
			cookie: () =>
				Effect.fail(
					new InvalidBearerTokenError({
						message: "Invalid session",
						detail: "Untrusted origin for a cookie session",
					}),
				),
			env: { UserObject: users.namespace },
		})
		expect((await refused.warm("", null, { origin: "https://evil.test" })).status).toBe(401)
		const down = build({
			verify: () => Effect.fail(new SessionLoadError({ message: "down", detail: "db" })),
			cookie: () => Effect.fail(new SessionLoadError({ message: "down", detail: "db" })),
			env: { UserObject: users.namespace },
		})
		expect((await down.warm("", null)).status).toBe(503)
		expect((await down.warm("")).status).toBe(503)
		expect(users.woken).toEqual([])
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

	it("sends each wake its span as traceparent", async () => {
		const spans: Array<Tracer.Span> = []
		const users = warmNamespace()
		const send = build({ verify, env: { UserObject: users.namespace }, spans })
		await send.warm("")
		const wake = spans.find((span) => span.name === "SyncRoute.warmObject")!
		expect(users.requests[0]!.headers.get("traceparent")).toBe(traceparentOf(wake))
	})
})
