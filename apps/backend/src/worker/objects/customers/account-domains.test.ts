import type { UpsertAccount } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { seedEnrichments } from "./enrichment/job"
import { type CustomersWorld, makeCustomersWorld, NOW, ok, tagOf } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const clerkOrg = (id: string, name: string, domains: ReadonlyArray<string>): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [...domains],
	sameAs: [],
	onNoMatch: "create",
})

const meta = (world: CustomersWorld, key: string) =>
	world.rows<{ value: string }>(`SELECT value FROM _object_meta WHERE key = ?`, key)[0]?.value

describe("customers.account.update addDomain", () => {
	it("an admin adds a company domain: cleaned, put first, logged, and a compute asked for", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_a", "Acme", ["gmail.com"])])
				const { id } = world.rows<{ id: CustomerAccountId }>(
					`SELECT id FROM customer_accounts WHERE name = 'Acme'`,
				)[0]!
				const domainsOf = () =>
					JSON.parse(
						world.rows<{ domains: string }>(
							`SELECT json(domains) AS domains FROM customer_accounts WHERE id = ?`,
							id,
						)[0]!.domains,
					)
				const add = (addDomain: string, user = world.owner) =>
					world.call("customers.account.update", { accountId: id, addDomain }, user)

				// The domains match chat and contacts to the customer: an admin's call.
				expect(tagOf(yield* add("acme.com", world.member))).not.toBe("Success")
				// A mail provider's domain is not a company's.
				expect(tagOf(yield* add("gmail.com"))).toBe("CustomersInvalidRequestError")

				// The ingest's compute is done: only the domain asks for the next one.
				world.object.storage.db.prepare(`DELETE FROM _object_meta WHERE key = 'computeDueAt'`).run()
				ok(yield* add(" https://www.Acme.com/pricing "))
				expect(domainsOf()).toEqual(["acme.com"])
				expect(meta(world, "computeDueAt")).toBeDefined()
				expect(
					world.rows(`SELECT type FROM customer_events WHERE type = 'account.domains_changed'`),
				).toHaveLength(1)

				// Added to the list as it is (another writer's domain stays), never replacing it.
				ok(yield* add("acme.io"))
				expect(domainsOf()).toEqual(["acme.io", "acme.com"])
				// One it has moves first.
				ok(yield* add("acme.com"))
				expect(domainsOf()).toEqual(["acme.com", "acme.io"])

				// The compute turn seeds its lookup.
				yield* world.object.run(seedEnrichments(NOW))
				expect(world.rows(`SELECT domain FROM customer_enrichments`)).toEqual([
					{ domain: "acme.com" },
				])
			}),
		))
})
