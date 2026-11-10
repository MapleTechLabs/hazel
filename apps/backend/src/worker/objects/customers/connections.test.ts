/**
 * Connection credentials through the RPCs, with a Stripe adapter registered (core registers none):
 * an API key of another provider account drops the old account's webhook secret.
 */
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it, vi } from "vitest"
import { makeCustomersWorld, ok } from "./test-kit"

// TEST-SEAM: core registers no adapter and the object's RPC handlers build their own services, so
// the registry's layer is the only place a test adapter can enter the real RPC path.
vi.mock("./providers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./providers")>()
	const { Effect, Layer, Option, Redacted } = await import("effect")
	const stripe: import("./providers").CustomerProviderAdapter = {
		provider: "stripe",
		// Each key opens its own account: `sk_a` → `acct_a`.
		validate: (credentials) =>
			Effect.succeed({
				externalAccountId: Redacted.value(credentials.apiKey).replace("sk_", "acct_"),
				externalAccountName: null,
			}),
		webhook: () => Effect.succeed([]),
		pull: () => Effect.die("not pulled here"),
		pullIntervalMs: 60 * 60_000,
	}
	// The class itself (its key) stays: only the layer `CustomersServicesLive` reads is replaced.
	Object.assign(actual.CustomerProviders, {
		layer: Layer.succeed(
			actual.CustomerProviders,
			actual.CustomerProviders.of({
				get: (provider) => (provider === "stripe" ? Option.some(stripe) : Option.none()),
			}),
		),
	})
	return actual
})

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe("Customers connection credentials", () => {
	it("an API key of another provider account drops the webhook secret not given with it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connection = () =>
					world.rows(
						`SELECT externalAccountId, hasWebhookSecret FROM customer_connections WHERE provider = 'stripe'`,
					)
				const secret = () =>
					world.rows<{ encryptedWebhookSecret: string | null }>(
						`SELECT encryptedWebhookSecret FROM customer_connection_secrets`,
					)[0]!.encryptedWebhookSecret
				const { id: connectionId } = ok(
					yield* world.call(
						"customers.connection.connect",
						{
							provider: "stripe",
							apiKey: "sk_a",
							webhookSecret: "whsec_a",
							config: DEFAULT_CONNECTION_CONFIG.stripe,
						},
						world.owner,
					),
				).data
				expect(connection()).toEqual([{ externalAccountId: "acct_a", hasWebhookSecret: 1 }])

				// The same account's new key keeps the secret.
				ok(
					yield* world.call(
						"customers.connection.update",
						{ connectionId, apiKey: "sk_a" },
						world.owner,
					),
				)
				expect(connection()).toEqual([{ externalAccountId: "acct_a", hasWebhookSecret: 1 }])
				expect(secret()).not.toBeNull()

				// Another account's: its deliveries are signed with another secret, so the old one goes.
				ok(
					yield* world.call(
						"customers.connection.update",
						{ connectionId, apiKey: "sk_b" },
						world.owner,
					),
				)
				expect(connection()).toEqual([{ externalAccountId: "acct_b", hasWebhookSecret: 0 }])
				expect(secret()).toBeNull()
			}),
		))
})
