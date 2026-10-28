import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { MarkOfflinePayload, MarkOfflineResponse, PresencePublicGroup } from "@hazel/domain/http"
import { UserId } from "@hazel/schema"
import { Effect, Layer, Schema, Context } from "effect"
import { Etag, HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder } from "effect/http-api"
import { HttpPresencePublicLive } from "./presence.http"
import { ObjectStubs } from "../worker/objects/protocol"

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
	it("returns HTTP 200 with a decodable MarkOfflineResponse", async () => {
		const api = HttpApi.make("HazelApp").add(PresencePublicGroup)
		const applied: Array<string> = []
		const routeLayer = HttpPresencePublicLive.pipe(
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
					headers: {
						"content-type": "application/json",
					},
					body: JSON.stringify(
						new MarkOfflinePayload({
							userId: UserId.make("00000000-0000-4000-8000-000000000222"),
						}),
					),
				}),
				Context.empty() as Context.Context<any>,
			)

			if (response.status !== 200) {
				throw new Error(await response.text())
			}

			const body = await response.json()
			const decoded = Schema.decodeUnknownSync(MarkOfflineResponse)(body)

			expect(decoded.success).toBe(true)
			expect(applied).toEqual(["user:00000000-0000-4000-8000-000000000222 user.markOffline"])
		} finally {
			await dispose()
		}
	})
})
