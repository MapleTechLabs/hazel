/**
 * Feature flags through the RPCs, against a fake Clerk that holds each organization's
 * `public_metadata` and merges writes the way Clerk does (a `null` removes the key).
 */
import { DEFAULT_CONNECTION_CONFIG, type UpsertAccount } from "@hazel/domain/customers"
import { Cause, Effect, Exit, type Scope } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCustomersWorld, ok, tagOf, type CustomersWorld } from "./test-kit"

const clerk = vi.hoisted(() => ({
	metadata: new Map<string, Record<string, unknown>>(),
	refused: new Set<string>(),
	writes: [] as Array<string>,
}))

// TEST-SEAM: the registry's layer is the only place a test adapter can enter the real RPC path.
vi.mock("./providers", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./providers")>()
	const { Effect, Layer, Option } = await import("effect")
	const { CustomerProviderError } = await import("./provider-errors")
	const adapter: import("./providers").CustomerProviderAdapter = {
		provider: "clerk",
		validate: () => Effect.succeed({ externalAccountId: "ins_1", externalAccountName: null }),
		webhook: () => Effect.succeed([]),
		pull: () => Effect.die("not pulled here"),
		pullIntervalMs: 60 * 60_000,
		setFeatureFlags: (_credentials, organizationId, changes) =>
			Effect.suspend(() => {
				clerk.writes.push(organizationId)
				if (clerk.refused.has(organizationId)) {
					return Effect.fail(
						new CustomerProviderError({
							code: "provider",
							message: "Clerk refused PATCH /organizations/{organization_id}/metadata (422)",
							httpStatus: 422,
							retryAfterMs: null,
						}),
					)
				}
				const next = { ...clerk.metadata.get(organizationId) }
				for (const [key, value] of Object.entries(changes)) {
					if (value === null) delete next[key]
					else next[key] = value
				}
				clerk.metadata.set(organizationId, next)
				return Effect.succeed(
					Object.fromEntries(
						Object.entries(next).filter(
							(entry): entry is [string, boolean] => typeof entry[1] === "boolean",
						),
					),
				)
			}),
	}
	Object.assign(actual.CustomerProviders, {
		layer: Layer.succeed(
			actual.CustomerProviders,
			actual.CustomerProviders.of({
				get: (provider) => (provider === "clerk" ? Option.some(adapter) : Option.none()),
			}),
		),
	})
	return actual
})

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const organization = (id: string, metadata: Record<string, unknown>): UpsertAccount => {
	clerk.metadata.set(id, metadata)
	return {
		_tag: "account",
		externalId: id,
		name: id,
		sameAs: [],
		onNoMatch: "create",
		featureFlags: Object.fromEntries(
			Object.entries(metadata).filter(
				(entry): entry is [string, boolean] => typeof entry[1] === "boolean",
			),
		),
	}
}

/** A world with a connected Clerk (credentials stored) and `orgs` ingested as its organizations. */
const setUp = (orgs: Record<string, Record<string, unknown>>) =>
	Effect.gen(function* () {
		const world = yield* makeCustomersWorld
		ok(
			yield* world.call(
				"customers.connection.connect",
				{
					provider: "clerk",
					apiKey: "sk_test_1",
					webhookSecret: null,
					config: DEFAULT_CONNECTION_CONFIG.clerk,
				},
				world.owner,
			),
		)
		yield* world.ingest(
			"clerk",
			Object.entries(orgs).map(([id, metadata]) => organization(id, metadata)),
		)
		return world
	})

const accountOf = (world: CustomersWorld, orgId: string) =>
	world.rows<{ accountId: string }>(
		`SELECT accountId FROM customer_external_refs WHERE provider = 'clerk' AND externalId = ?`,
		orgId,
	)[0]!.accountId

const flagsOf = (world: CustomersWorld, orgId: string) =>
	JSON.parse(
		world.rows<{ featureFlags: string }>(
			`SELECT featureFlags FROM customer_accounts WHERE id = ?`,
			accountOf(world, orgId),
		)[0]!.featureFlags,
	)

const messageOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? String((Cause.squash(exit.cause) as { message?: string }).message) : ""

beforeEach(() => {
	clerk.metadata.clear()
	clerk.refused.clear()
	clerk.writes.length = 0
})

describe("Customers feature flags", () => {
	it("syncs the boolean metadata, and turns flags on and off in Clerk, keeping other metadata", () =>
		run(
			Effect.gen(function* () {
				const world = yield* setUp({
					org_a: { beta: true, plan: "pro" },
					org_b: { legacy: false },
				})
				expect(flagsOf(world, "org_a")).toEqual({ beta: true })
				expect(flagsOf(world, "org_b")).toEqual({ legacy: false })

				const accountIds = [accountOf(world, "org_a"), accountOf(world, "org_b")]
				ok(
					yield* world.call(
						"customers.featureFlags.set",
						{ accountIds, keys: ["new_nav", "ai"], enabled: true },
						world.owner,
					),
				)
				expect(clerk.metadata.get("org_a")).toEqual({
					beta: true,
					plan: "pro",
					new_nav: true,
					ai: true,
				})
				expect(flagsOf(world, "org_b")).toEqual({ legacy: false, new_nav: true, ai: true })

				ok(
					yield* world.call(
						"customers.featureFlags.set",
						{ accountIds: [accountIds[0]], keys: ["beta", "ai"], enabled: false },
						world.owner,
					),
				)
				expect(clerk.metadata.get("org_a")).toEqual({ plan: "pro", new_nav: true })
				expect(flagsOf(world, "org_a")).toEqual({ new_nav: true })
			}),
		))

	it("creates a flag once, and deleting one removes it from every customer holding it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* setUp({ org_a: { beta: true }, org_b: { beta: false }, org_c: {} })
				ok(yield* world.call("customers.featureFlag.create", { key: "beta" }, world.owner))
				const again = yield* world.call("customers.featureFlag.create", { key: "beta" }, world.owner)
				expect(tagOf(again)).toBe("CustomersInvalidRequestError")
				expect(world.rows(`SELECT key FROM customer_feature_flags`)).toEqual([{ key: "beta" }])

				ok(yield* world.call("customers.featureFlag.delete", { key: "beta" }, world.owner))
				expect(clerk.writes.sort()).toEqual(["org_a", "org_b"])
				expect(clerk.metadata.get("org_b")).toEqual({})
				expect(flagsOf(world, "org_a")).toEqual({})
				expect(flagsOf(world, "org_b")).toEqual({})
				expect(world.rows(`SELECT key FROM customer_feature_flags`)).toEqual([])
			}),
		))

	it("writes the customers Clerk accepted and names the ones it refused; the flag stays", () =>
		run(
			Effect.gen(function* () {
				const world = yield* setUp({ org_a: { beta: true }, org_b: { beta: true } })
				ok(yield* world.call("customers.featureFlag.create", { key: "beta" }, world.owner))
				clerk.refused.add("org_b")
				const exit = yield* world.call("customers.featureFlag.delete", { key: "beta" }, world.owner)
				expect(tagOf(exit)).toBe("CustomerFeatureFlagsError")
				expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
					failedAccountIds: [accountOf(world, "org_b")],
				})
				expect(flagsOf(world, "org_a")).toEqual({})
				expect(flagsOf(world, "org_b")).toEqual({ beta: true })
				expect(world.rows(`SELECT key FROM customer_feature_flags`)).toEqual([{ key: "beta" }])
			}),
		))

	it("refuses while Clerk rejects the secret key, before any request", () =>
		run(
			Effect.gen(function* () {
				const world = yield* setUp({ org_a: {} })
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET status = 'error', lastError = ? WHERE provider = 'clerk'`,
					)
					.run(
						JSON.stringify({
							code: "auth",
							message: "Clerk rejected the secret key (401)",
							httpStatus: 401,
						}),
					)
				const exit = yield* world.call(
					"customers.featureFlags.set",
					{ accountIds: [accountOf(world, "org_a")], keys: ["beta"], enabled: true },
					world.owner,
				)
				expect(tagOf(exit)).toBe("CustomersInvalidRequestError")
				expect(messageOf(exit)).toContain("Clerk rejected the secret key")
				expect(clerk.writes).toEqual([])
			}),
		))

	it("refuses an account with no Clerk organization before writing anything", () =>
		run(
			Effect.gen(function* () {
				const world = yield* setUp({ org_a: {} })
				yield* world.ingest("stripe", [
					{
						_tag: "account",
						externalId: "cus_1",
						name: "Billing only",
						sameAs: [],
						onNoMatch: "create",
					},
				])
				const stripeOnly = world.rows<{ accountId: string }>(
					`SELECT accountId FROM customer_external_refs WHERE externalId = 'cus_1'`,
				)[0]!.accountId
				const exit = yield* world.call(
					"customers.featureFlags.set",
					{ accountIds: [accountOf(world, "org_a"), stripeOnly], keys: ["beta"], enabled: true },
					world.owner,
				)
				expect(tagOf(exit)).toBe("CustomersInvalidRequestError")
				expect(messageOf(exit)).toContain("Billing only has no Clerk organization")
				expect(clerk.writes).toEqual([])
			}),
		))
})
