/**
 * `customers.webhook` in the object: which deliveries reach the adapter (a live connection of that
 * provider with a webhook secret), and what the route is told (404, 400, or the applied count).
 */
import type { IngestOp } from "@hazel/domain/customers"
import type { CustomerConnectionId } from "@hazel/schema"
import { ConfigProvider, Effect, Exit, Layer, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { encryptSecrets, storeSecrets } from "./credentials"
import { CustomerIngest } from "./ingest"
import { handleWebhookWith } from "./jobs"
import { type CustomerProviderAdapter, CustomerProviders, CustomerWebhookRejectedError } from "./providers"
import { type CustomersWorld, makeCustomersWorld } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const encryption = IntegrationEncryption.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }),
		),
	),
)

/** A Stripe adapter whose deliveries answer `parse(body)`. */
const stripeAdapter = (
	parse: (body: string) => Effect.Effect<ReadonlyArray<IngestOp>, CustomerWebhookRejectedError>,
): CustomerProviderAdapter => ({
	provider: "stripe",
	validate: () => Effect.succeed({ externalAccountId: null, externalAccountName: null }),
	webhook: (request) => parse(request.body),
	pull: () => Effect.die("no pulls here"),
	pullIntervalMs: 60 * 60_000,
})

const deliver = (
	world: CustomersWorld,
	connectionId: CustomerConnectionId,
	options: {
		readonly provider?: "stripe" | "clerk"
		readonly adapter?: CustomerProviderAdapter
		readonly body?: string
	} = {},
) =>
	world.object
		.run(
			handleWebhookWith(
				Layer.mergeAll(
					CustomerIngest.layer,
					encryption,
					Layer.succeed(
						CustomerProviders,
						CustomerProviders.of({
							get: (provider) =>
								provider === "stripe" && options.adapter !== undefined
									? Option.some(options.adapter)
									: Option.none(),
						}),
					),
				),
			)({
				connectionId,
				provider: options.provider ?? "stripe",
				headers: {},
				body: options.body ?? "{}",
			}).pipe(Effect.exit),
		)
		.pipe(
			Effect.orDie,
			Effect.map((exit) =>
				Exit.isSuccess(exit)
					? { applied: exit.value.applied }
					: (() => {
							const error = Exit.findErrorOption(exit)
							return Option.isSome(error)
								? { status: error.value.status, message: error.value.message }
								: { defect: true }
						})(),
			),
		)

/** A live Stripe connection with stored credentials (`webhookSecret` null: none stored). */
const liveConnection = (world: CustomersWorld, webhookSecret: string | null) =>
	Effect.gen(function* () {
		const connectionId = world.connection("stripe")
		world.object.storage.db
			.prepare(`UPDATE customer_connections SET status = 'active', hasWebhookSecret = 1 WHERE id = ?`)
			.run(connectionId)
		yield* world.object
			.run(
				Effect.gen(function* () {
					yield* storeSecrets(connectionId, yield* encryptSecrets("sk_test", webhookSecret))
				}).pipe(Effect.provide(encryption)),
			)
			.pipe(Effect.orDie)
		return connectionId
	})

const account: IngestOp = {
	_tag: "account",
	externalId: "cus_1",
	name: "Acme",
	domains: ["acme.com"],
	sameAs: [],
	onNoMatch: "create",
}

describe("Customers webhook delivery", () => {
	it("answers 404 for another provider's, a disconnected or an unintegrated connection", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = yield* liveConnection(world, "whsec")
				const adapter = stripeAdapter(() => Effect.succeed([]))
				expect(yield* deliver(world, connectionId, { provider: "clerk", adapter })).toMatchObject({
					status: 404,
				})
				expect(yield* deliver(world, connectionId)).toEqual({
					status: 404,
					message: "No stripe integration",
				})
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET status = 'disconnected' WHERE id = ?`)
					.run(connectionId)
				expect(yield* deliver(world, connectionId, { adapter })).toMatchObject({ status: 404 })
			}),
		))

	it("answers 400 without calling the adapter when no webhook secret is stored", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = yield* liveConnection(world, null)
				let called = false
				const adapter = stripeAdapter(() => Effect.sync(() => ((called = true), [])))
				expect(yield* deliver(world, connectionId, { adapter })).toEqual({
					status: 400,
					message: "The connection has no webhook secret",
				})
				expect(called).toBe(false)
			}),
		))

	it("answers 400 for a rejected delivery or an op off the contract, else the applied count", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = yield* liveConnection(world, "whsec")
				const rejecting = stripeAdapter(() =>
					Effect.fail(new CustomerWebhookRejectedError({ message: "Bad signature" })),
				)
				expect(yield* deliver(world, connectionId, { adapter: rejecting })).toEqual({
					status: 400,
					message: "Bad signature",
				})
				const badDay = stripeAdapter(() =>
					Effect.succeed([
						{
							_tag: "activity",
							contact: { provider: "stripe", externalId: "user_1" },
							account: { provider: "stripe", externalId: "cus_1" },
							day: "2026-02-30",
							eventCount: 1,
						} satisfies IngestOp,
					]),
				)
				expect(yield* deliver(world, connectionId, { adapter: badDay })).toMatchObject({
					status: 400,
				})
				const parsing = stripeAdapter(() => Effect.succeed([account]))
				expect(yield* deliver(world, connectionId, { adapter: parsing })).toEqual({ applied: 1 })
			}),
		))
})
