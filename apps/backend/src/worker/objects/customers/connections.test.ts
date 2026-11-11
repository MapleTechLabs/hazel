/**
 * Connection credentials through the RPCs, with a Stripe adapter registered (core registers none):
 * an API key of another provider account drops the old account's webhook secret, and an update
 * refuses a connection that changed while the provider checked the key.
 */
import { DEFAULT_CONNECTION_CONFIG, MapleConnectionConfig } from "@hazel/domain/customers"
import { Cause, Effect, Exit, Schema, type Scope } from "effect"
import { describe, expect, it, vi } from "vitest"
import { makeCustomersWorld, ok, tagOf } from "./test-kit"

/** Runs while the provider checks a key (another request's turn). */
const validating = vi.hoisted(() => ({ hook: (): void => undefined }))

// TEST-SEAM: core registers no adapter and the object's RPC handlers build their own services, so
// the registry's layer is the only place a test adapter can enter the real RPC path.
vi.mock("./providers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./providers")>()
	const { Effect, Layer, Option, Redacted } = await import("effect")
	const stripe: import("./providers").CustomerProviderAdapter = {
		provider: "stripe",
		// Each key opens its own account: `sk_a` → `acct_a`.
		validate: (credentials) =>
			Effect.sync(() => {
				validating.hook()
				return {
					externalAccountId: Redacted.value(credentials.apiKey).replace("sk_", "acct_"),
					externalAccountName: null,
				}
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

const messageOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? String((Cause.squash(exit.cause) as { message?: string }).message) : ""

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

	it("refuses an update when the connection moved to another account while the key was checked", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
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
				const secrets = () => world.rows(`SELECT * FROM customer_connection_secrets`)
				const before = secrets()
				validating.hook = () =>
					world.object.storage.db
						.prepare(`UPDATE customer_connections SET externalAccountId = 'acct_c' WHERE id = ?`)
						.run(connectionId)
				try {
					const exit = yield* world.call(
						"customers.connection.update",
						{ connectionId, apiKey: "sk_a" },
						world.owner,
					)
					expect(tagOf(exit)).toBe("CustomersInvalidRequestError")
				} finally {
					validating.hook = () => undefined
				}
				expect(
					world.rows(
						`SELECT externalAccountId FROM customer_connections WHERE id = ?`,
						connectionId,
					),
				).toEqual([{ externalAccountId: "acct_c" }])
				expect(secrets()).toEqual(before)
			}),
		))

	it("refuses Maple names it cannot send, naming them, and a query too long for Maple", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connect = (config: Partial<typeof DEFAULT_CONNECTION_CONFIG.maple>) =>
					world.call(
						"customers.connection.connect",
						{
							provider: "maple",
							apiKey: "maple_ak_x",
							webhookSecret: null,
							config: { ...DEFAULT_CONNECTION_CONFIG.maple, ...config },
						},
						world.owner,
					)
				const refusal = yield* connect({ activityEvents: ["$__orgFilter", "dashboard_created"] })
				expect(tagOf(refusal)).toBe("CustomersInvalidRequestError")
				expect(messageOf(refusal)).toContain(`"$__orgFilter"`)
				expect(messageOf(refusal)).not.toContain("dashboard_created")
				const mapping = yield* connect({
					metricMappings: [
						{ event: "query_run", metricKey: "queries" },
						{ event: "has space", metricKey: "spaces" },
					],
				})
				expect(messageOf(mapping)).toContain(`"has space → spaces"`)
				// The longest names, as many as the schema takes, still fit one `run_sql` statement: the
				// check passes them on (to the adapter, which this test has none of).
				const events = Array.from({ length: 100 }, (_, index) => `${index}`.padEnd(120, "e"))
				const longest = {
					activityEvents: events,
					metricMappings: events
						.slice(0, 50)
						.map((event, index) => ({ event, metricKey: `${index}`.padEnd(80, "k") })),
				}
				expect(tagOf(yield* connect(longest))).toBe("CustomerProviderUnavailableError")
				const decode = Schema.decodeUnknownExit(MapleConnectionConfig)
				const base = { ...DEFAULT_CONNECTION_CONFIG.maple, ...longest }
				expect(Exit.isSuccess(decode(base))).toBe(true)
				// Configs stored before the organization came from the key still decode.
				expect(
					Exit.isSuccess(
						decode({ ...base, mapleOrgId: "org_a", accountKey: "GroupId", userKey: "UserId" }),
					),
				).toBe(true)
				expect(Exit.isSuccess(decode({ ...base, activityEvents: [...events, "one_more"] }))).toBe(
					false,
				)
				expect(
					Exit.isSuccess(
						decode({
							...base,
							metricMappings: [
								...base.metricMappings,
								{ event: "one_more", metricKey: "more" },
							],
						}),
					),
				).toBe(false)
			}),
		))

	it("refuses a Maple region change without a key: nothing would check it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("maple")
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET externalAccountId = 'org_a:us' WHERE id = ?`)
					.run(connectionId)
				const update = (config: Partial<typeof DEFAULT_CONNECTION_CONFIG.maple>) =>
					world.call(
						"customers.connection.update",
						{
							connectionId,
							config: { ...DEFAULT_CONNECTION_CONFIG.maple, ...config },
						},
						world.owner,
					)
				expect(tagOf(yield* update({ region: "eu" }))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* update({ lookbackDays: 30 }))).toBe("Success")
			}),
		))
})
