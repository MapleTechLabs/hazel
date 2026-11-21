import { normalizeDomain, type UpsertAccount } from "@hazel/domain/customers"
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
				// Nor is what DNS would not take: a label over 63 characters, or one edged by a hyphen.
				expect(tagOf(yield* add(`${"a".repeat(64)}.com`))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* add("-acme.com"))).toBe("CustomersInvalidRequestError")
				expect(normalizeDomain(`${"a".repeat(63)}.com`)).toBe(`${"a".repeat(63)}.com`)

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

				// A full list refuses another rather than dropping one; one it has still moves first.
				const full = Array.from({ length: 20 }, (_, index) => `full${index}.com`)
				yield* world.ingest("clerk", [clerkOrg("org_full", "Full", full)])
				const fullId = world.rows<{ id: CustomerAccountId }>(
					`SELECT id FROM customer_accounts WHERE name = 'Full'`,
				)[0]!.id
				const addFull = (addDomain: string) =>
					world.call("customers.account.update", { accountId: fullId, addDomain }, world.owner)
				expect(tagOf(yield* addFull("one-more.com"))).toBe("CustomersInvalidRequestError")
				ok(yield* addFull("full19.com"))
				const fullNow = JSON.parse(
					world.rows<{ domains: string }>(
						`SELECT json(domains) AS domains FROM customer_accounts WHERE id = ?`,
						fullId,
					)[0]!.domains,
				)
				expect(fullNow).toEqual(["full19.com", ...full.slice(0, 19)])

				// The compute turn seeds its lookup.
				yield* world.object.run(seedEnrichments(NOW))
				expect(world.rows(`SELECT domain FROM customer_enrichments ORDER BY domain`)).toEqual([
					{ domain: "acme.com" },
					{ domain: "full19.com" },
				])
			}),
		))
})
