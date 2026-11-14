/**
 * `GET /sync/:kind/:id`: what the route forwards (the principal's expiry) and how it closes a
 * socket it cannot serve (4001 for a bad token, 1011 for everything that is not the token's fault).
 */
import { Database } from "@hazel/db"
import { CurrentUser, SessionLoadError } from "@hazel/domain"
import { SYNC_MUX_SUBPROTOCOL, SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import type { UserId } from "@hazel/schema"
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
