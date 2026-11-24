/**
 * Core's side of the integration boundary (`docs/customers/integrations.md`): provider ids and configs
 * are open strings and records in the contracts, so the handlers and routes refuse what the registry
 * does not know.
 */
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/customer-integrations"
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { describe, expect, it } from "vitest"
import { handleCustomersWebhook } from "../../../routes/customers-webhooks.http"
import { Directory } from "../../../services/directory"
import { ObjectStubs } from "../protocol"
import { makeCustomersWorld, ok, tagOf } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe("provider ids and configs from outside", () => {
	it("refuses a connect naming an unknown provider or a config its schema rejects", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connect = (provider: string, config: ConnectionConfig) =>
					world.call(
						"customers.connection.connect",
						{ provider, apiKey: "key", webhookSecret: null, config },
						world.owner,
					)
				const before = world.rows(`SELECT count(*) AS n FROM customer_connections`)
				expect(tagOf(yield* connect("nope", { _tag: "nope" }))).toBe(
					"CustomerProviderUnavailableError",
				)
				expect(tagOf(yield* connect("nope", DEFAULT_CONNECTION_CONFIG.clerk))).toBe(
					"CustomersInvalidRequestError",
				)
				expect(
					tagOf(yield* connect("maple", { ...DEFAULT_CONNECTION_CONFIG.maple, lookbackDays: 0 })),
				).toBe("CustomersInvalidRequestError")
				expect(world.rows(`SELECT count(*) AS n FROM customer_connections`)).toEqual(before)
			}),
		))

	it("stores a submitted config as its schema decodes it: defaults in, dropped keys out", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("maple")
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET externalAccountId = 'org_a:us' WHERE id = ?`)
					.run(connectionId)
				const legacy = {
					_tag: "maple",
					activityEvents: ["signed_in"],
					metricMappings: [],
					lookbackDays: 30,
					mapleOrgId: "org_a",
					accountKey: "GroupId",
					userKey: "UserId",
				}
				ok(
					yield* world.call(
						"customers.connection.update",
						{ connectionId, config: legacy },
						world.owner,
					),
				)
				const [row] = world.rows<{ config: string }>(
					`SELECT config FROM customer_connections WHERE id = '${connectionId}'`,
				)
				expect(JSON.parse(row!.config)).toEqual({
					_tag: "maple",
					region: "us",
					activityEvents: ["signed_in"],
					metricMappings: [],
					lookbackDays: 30,
				})
			}),
		))

	it("refuses attention settings naming an unknown source, writing nothing", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const attention = () => world.rows(`SELECT attention FROM customer_settings`)
				const before = attention()
				const refused = yield* world.call(
					"customers.settings.update",
					{ attention: { stages: ["active"], requiredSources: ["nope"] } },
					world.owner,
				)
				expect(tagOf(refused)).toBe("InternalServerError")
				expect(attention()).toEqual(before)
				ok(
					yield* world.call(
						"customers.settings.update",
						{ attention: { stages: ["active"], requiredSources: ["autumn"] } },
						world.owner,
					),
				)
			}),
		))

	it("answers a webhook for an unknown provider 404, waking nothing", async () => {
		const response = await Effect.runPromise(
			handleCustomersWebhook.pipe(
				Effect.provideService(
					HttpServerRequest.HttpServerRequest,
					HttpServerRequest.fromWeb(
						new Request(
							"http://api.test/webhooks/customers/nope/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002",
							{ method: "POST", body: "{}" },
						),
					),
				),
				Effect.provideService(Directory, { org: () => Effect.die("looked up") } as never),
				Effect.provideService(ObjectStubs, { get: () => Effect.die("woken") } as never),
				Effect.map((answer) => HttpServerResponse.toWeb(answer)),
			),
		)
		expect(response.status).toBe(404)
	})
})
