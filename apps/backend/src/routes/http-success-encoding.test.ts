import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { MarkOfflinePayload, MarkOfflineResponse, PresencePublicGroup } from "@hazel/domain/http"
import { UserId } from "@hazel/schema"
import { Effect, Layer, Option, Schema, Context } from "effect"
import { Etag, HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder } from "effect/http-api"
import { HttpPresencePublicLive } from "./presence.http"
import { serviceShape } from "../test/effect-helpers"
import { ObjectStubs } from "../worker/objects/protocol"
import { AuthorizationLive } from "../services/auth"
import { HazelSession } from "../services/hazel-session"
import { CurrentUser } from "@hazel/domain"

const sessionUser = (id: UserId) =>
	new CurrentUser.Schema({
		id,
		organizationId: null,
		role: "member",
		email: "caller@example.com",
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

const makeHandler = (api: any, routeLayer: any) => {
	const appLayer = HttpApiBuilder.layer(api).pipe(
		Layer.provideMerge(routeLayer),
		Layer.provideMerge(HttpRouter.layer),
		Layer.provideMerge(Etag.layer),
		Layer.provideMerge(NodeServices.layer),
		Layer.provideMerge(NodeHttpPlatform.layer),
	)

	return HttpRouter.toWebHandler(appLayer as never, {
		disableLogger: true,
	})
}

describe("HTTP success response encoding", () => {
	const caller = UserId.make("00000000-0000-4000-8000-000000000222")
	const other = UserId.make("00000000-0000-4000-8000-000000000999")

	/** The real HttpApi auth middleware over a session that knows one cookie and one bearer. */
	const FakeSession = Layer.succeed(
		HazelSession,
		serviceShape<typeof HazelSession>({
			fromCookie: (headers: Record<string, string>) =>
				Effect.succeed(
					(headers.cookie ?? "").includes("hazel_session=ok")
						? Option.some(sessionUser(caller))
						: Option.none(),
				),
			verify: (token: string) =>
				Effect.succeed(token === "native" ? Option.some(sessionUser(caller)) : Option.none()),
		}),
	)

	const markOffline = async (userId: UserId, headers: Record<string, string>) => {
		const api = HttpApi.make("HazelApp").add(PresencePublicGroup)
		const applied: Array<string> = []
		const routeLayer = HttpPresencePublicLive.pipe(
			Layer.provideMerge(AuthorizationLive.pipe(Layer.provide(FakeSession))),
			Layer.provideMerge(
				Layer.succeed(ObjectStubs, {
					get: (target) => ({
						invoke: () => Effect.die("unused"),
						call: () => Effect.die("unused"),
						applyEffect: (request) =>
							Effect.sync(() => {
								applied.push(`${target.kind}:${target.id} ${request.kind}`)
								return { _tag: "Applied" as const, seq: 1 }
							}),
					}),
				}),
			),
		)

		const { handler, dispose } = makeHandler(api, routeLayer)

		try {
			const response = await handler(
				new Request("http://localhost/presence/offline", {
					method: "POST",
					headers: { "content-type": "application/json", ...headers },
					body: JSON.stringify(new MarkOfflinePayload({ userId })),
				}),
				Context.empty() as Context.Context<any>,
			)
			return { status: response.status, body: await response.json(), applied }
		} finally {
			await dispose()
		}
	}

	it("marks the cookie session's user offline (sendBeacon) with a decodable MarkOfflineResponse", async () => {
		const result = await markOffline(caller, { cookie: "hazel_session=ok" })
		expect(result.status).toBe(200)
		expect(Schema.decodeUnknownSync(MarkOfflineResponse)(result.body).success).toBe(true)
		expect(result.applied).toEqual([`user:${caller} user.markOffline`])
	})

	it("accepts a native client's bearer", async () => {
		const result = await markOffline(caller, { authorization: "Bearer native" })
		expect(result.status).toBe(200)
		expect(result.applied).toEqual([`user:${caller} user.markOffline`])
	})

	it("refuses an unauthenticated caller", async () => {
		const result = await markOffline(caller, {})
		expect(result.status).not.toBe(200)
		expect(result.body._tag).toBe("InvalidBearerTokenError")
		expect(result.applied).toEqual([])
	})

	it("refuses marking another user offline", async () => {
		const result = await markOffline(other, { cookie: "hazel_session=ok" })
		expect(result.status).toBe(401)
		expect(result.body._tag).toBe("UnauthorizedError")
		expect(result.applied).toEqual([])
	})
})
