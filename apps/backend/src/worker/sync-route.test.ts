/**
 * `GET /sync/:kind/:id`: what the route forwards (the principal's expiry) and how it closes a
 * socket it cannot serve (4001 for a bad token, 1011 for everything that is not the token's fault).
 */
import { Database } from "@hazel/db"
import { CurrentUser, SessionLoadError } from "@hazel/domain"
import { SYNC_SUBPROTOCOL, SyncCloseCode } from "@hazel/domain/sync"
import type { UserId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { HttpRouter } from "effect/http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Directory } from "../services/directory"
import { HazelSession, type VerifiedUser } from "../services/hazel-session"
import { decodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER } from "./objects/principal"
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
	return (path: string) =>
		(web.handler as (request: Request) => Promise<Response>)(
			new Request(`http://api.test${path}`, {
				headers: { upgrade: "websocket", "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, ${jwt}` },
			}),
		)
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
