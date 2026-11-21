import type { UpsertAccount } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { seedEnrichments } from "./enrichment/job"
import { makeCustomersWorld, NOW, ok, tagOf } from "./test-kit"

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

describe("customers.account.update domains", () => {
	it("an admin adds a company domain: cleaned, logged, and its company looked up", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_a", "Acme", [])])
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

				// The domains match chat and contacts to the customer: an admin's call.
				expect(
					tagOf(
						yield* world.call(
							"customers.account.update",
							{ accountId: id, domains: ["acme.com"] },
							world.member,
						),
					),
				).not.toBe("Success")
				// A mail provider's domain is not a company's.
				expect(
					tagOf(
						yield* world.call(
							"customers.account.update",
							{ accountId: id, domains: ["gmail.com"] },
							world.owner,
						),
					),
				).toBe("CustomersInvalidRequestError")
				expect(domainsOf()).toEqual([])

				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: id, domains: [" https://www.Acme.com/pricing ", "acme.com"] },
						world.owner,
					),
				)
				expect(domainsOf()).toEqual(["acme.com"])
				expect(
					world.rows(`SELECT type FROM customer_events WHERE type = 'account.domains_changed'`),
				).toHaveLength(1)

				yield* world.object.run(seedEnrichments(NOW))
				expect(world.rows(`SELECT domain FROM customer_enrichments`)).toEqual([
					{ domain: "acme.com" },
				])
			}),
		))
})
