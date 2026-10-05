import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { BotRepo, UserPresenceStatusRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import {
	InternalApiGroup,
	MarkOfflinePayload,
	MarkOfflineResponse,
	MockDataGroup,
	PresencePublicGroup,
	ValidateBotTokenRequest,
	ValidateBotTokenResponse,
	GenerateMockDataRequest,
	GenerateMockDataResponse,
} from "@hazel/domain/http"
import { BotId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Layer, Option, Schema, Context } from "effect"
import { Etag, HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder } from "effect/http-api"
import { vi } from "vitest"
import { HttpInternalLive } from "./internal.http"
import { HttpMockDataLive } from "./mock-data.http"
import { HttpPresencePublicLive } from "./presence.http"
import { MockDataGenerator } from "../services/mock-data-generator"
import { configLayer, serviceShape } from "../test/effect-helpers"

vi.mock("@hazel/effect-bun", async () => {
	const { Layer, Context } = await import("effect")

	class Redis extends Context.Service<
		Redis,
		{
			readonly get: (key: string) => unknown
			readonly del: (key: string) => unknown
			readonly send: <T = unknown>(command: string, args: string[]) => T
		}
	>()("@hazel/effect-bun/Redis") {}

	return {
		Redis: Object.assign(Redis, {
			Default: Layer.empty,
		}),
	}
})

const makeCurrentUser = () =>
	({
		id: UserId.make("00000000-0000-4000-8000-000000000111"),
		organizationId: OrganizationId.make("00000000-0000-4000-8000-000000000123"),
		role: "owner",
		avatarUrl: undefined,
		firstName: "Test",
		lastName: "User",
		email: "test@example.com",
		isOnboarded: true,
		timezone: null,
		settings: null,
	}) satisfies Schema.Schema.Type<typeof CurrentUser.Schema>

const makeAuthorizationLayer = (currentUser = makeCurrentUser()) =>
	Layer.succeed(
		CurrentUser.Authorization,
		CurrentUser.Authorization.of({
			bearer: (httpEffect) => Effect.provideService(httpEffect, CurrentUser.Context, currentUser),
		}),
	)

const makeDatabaseLayer = () =>
	Layer.succeed(
		Database.Database,
		serviceShape<typeof Database.Database>({
			transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				Effect.provideService(effect, Database.TransactionContext, {
					execute: (fn) =>
						Effect.promise(() =>
							fn({
								execute: async () => [{ txid: "42" }],
							} as never),
						),
				}),
		}),
	)

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
	it("returns HTTP 200 with a decodable GenerateMockDataResponse", async () => {
		const api = HttpApi.make("HazelApp").add(MockDataGroup)
		const routeLayer = HttpMockDataLive.pipe(
			Layer.provideMerge(
				Layer.succeed(
					MockDataGenerator,
					serviceShape<typeof MockDataGenerator>({
						generateForMarketingScreenshots: () =>
							Effect.succeed({
								summary: {
									users: 1,
									channels: 2,
									channelSections: 3,
									messages: 4,
									organizationMembers: 5,
									channelMembers: 6,
									threads: 7,
								},
							}),
					}),
				),
			),
			Layer.provideMerge(makeDatabaseLayer()),
			Layer.provideMerge(makeAuthorizationLayer()),
		)

		const { handler, dispose } = makeHandler(api, routeLayer)

		try {
			const response = await handler(
				new Request("http://localhost/mock-data/generate", {
					method: "POST",
					headers: {
						authorization: "Bearer test-token",
						"content-type": "application/json",
					},
					body: JSON.stringify(
						new GenerateMockDataRequest({
							organizationId: "00000000-0000-4000-8000-000000000123",
						}),
					),
				}),
				Context.empty() as Context.Context<any>,
			)

			if (response.status !== 200) {
				throw new Error(await response.text())
			}

			const body = await response.json()
			const decoded = Schema.decodeUnknownSync(GenerateMockDataResponse)(body)

			expect(decoded.transactionId).toBeDefined()
			expect(decoded.created.messages).toBe(4)
		} finally {
			await dispose()
		}
	})

	it("returns HTTP 200 with a decodable MarkOfflineResponse", async () => {
		const api = HttpApi.make("HazelApp").add(PresencePublicGroup)
		const routeLayer = HttpPresencePublicLive.pipe(
			Layer.provideMerge(
				Layer.succeed(
					UserPresenceStatusRepo,
					serviceShape<typeof UserPresenceStatusRepo>({
						updateStatus: () => Effect.void,
					}),
				),
			),
			Layer.provideMerge(makeDatabaseLayer()),
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
		} finally {
			await dispose()
		}
	})

	it("returns HTTP 200 with a decodable ValidateBotTokenResponse", async () => {
		const api = HttpApi.make("HazelApp").add(InternalApiGroup)
		const routeLayer = HttpInternalLive.pipe(
			Layer.provideMerge(
				Layer.succeed(
					BotRepo,
					serviceShape<typeof BotRepo>({
						findByTokenHash: () =>
							Effect.succeed(
								Option.some({
									id: BotId.make("00000000-0000-4000-8000-000000000456"),
									userId: UserId.make("00000000-0000-4000-8000-000000000333"),
									scopes: ["messages:write"],
								}),
							),
					}),
				),
			),
			Layer.provideMerge(configLayer({})),
		)

		const { handler, dispose } = makeHandler(api, routeLayer)

		try {
			const response = await handler(
				new Request("http://localhost/internal/actors/validate-bot-token", {
					method: "POST",
					headers: {
						"content-type": "application/json",
					},
					body: JSON.stringify(
						new ValidateBotTokenRequest({
							token: "hzl_bot_valid_token",
						}),
					),
				}),
				Context.empty() as Context.Context<any>,
			)

			if (response.status !== 200) {
				throw new Error(await response.text())
			}

			const body = await response.json()
			const decoded = Schema.decodeUnknownSync(ValidateBotTokenResponse)(body)

			expect(decoded.userId).toBe("00000000-0000-4000-8000-000000000333")
			expect(decoded.scopes).toEqual(["messages:write"])
		} finally {
			await dispose()
		}
	})
})
