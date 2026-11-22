import type { IngestOp, UpsertAccount, UpsertContact } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { inferAccountDomains, inferDomain, SHARED_DOMAIN_CUSTOMERS } from "./domain-inference"
import { seedEnrichments } from "./enrichment/job"
import { type CustomersWorld, makeCustomersWorld, NOW, ok, tagOf } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const clerkOrg = (id: string, name: string, domains: ReadonlyArray<string> = []): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [...domains],
	sameAs: [],
	onNoMatch: "create",
})

const member = (id: string, org: string, email: string, role = "org:member"): UpsertContact => ({
	_tag: "contact",
	externalId: id,
	account: { provider: "clerk", externalId: org },
	email,
	name: id,
	role,
})

const idOf = (world: CustomersWorld, name: string) =>
	world.rows<{ id: CustomerAccountId }>(`SELECT id FROM customer_accounts WHERE name = ?`, name)[0]!.id

const domainsOf = (world: CustomersWorld, name: string): ReadonlyArray<string> =>
	JSON.parse(
		world.rows<{ domains: string }>(
			`SELECT json(domains) AS domains FROM customer_accounts WHERE name = ?`,
			name,
		)[0]!.domains,
	)

const infer = (world: CustomersWorld) => world.object.run(inferAccountDomains(NOW)).pipe(Effect.orDie)

describe("inferDomain", () => {
	const none = new Set<string>()
	const work = (email: string, role: string | null = null) => ({ email, role })

	it("takes the work domain most members use, mail providers aside", () => {
		expect(
			inferDomain(
				[work("ann@gmail.com"), work("bo@acme.com"), work("cy@Acme.com"), work("di@acme.io")],
				none,
			),
		).toBe("acme.com")
	})

	it("guesses nothing from mail providers only, no email, or a tie", () => {
		expect(inferDomain([work("ann@gmail.com"), work("bo@icloud.com")], none)).toBeNull()
		expect(inferDomain([{ email: null, role: null }, work("not-an-email")], none)).toBeNull()
		expect(inferDomain([work("ann@acme.com"), work("bo@globex.com")], none)).toBeNull()
	})

	it("an admin's email breaks a tie", () => {
		expect(inferDomain([work("ann@acme.com", "org:admin"), work("bo@globex.com")], none)).toBe("acme.com")
	})

	it("a domain shared across customers does not count", () => {
		expect(
			inferDomain(
				[work("ann@acme.com"), work("help@vendor.dev"), work("ops@vendor.dev")],
				new Set(["vendor.dev"]),
			),
		).toBe("acme.com")
		expect(inferDomain([work("help@vendor.dev")], new Set(["vendor.dev"]))).toBeNull()
	})
})

describe("inferAccountDomains", () => {
	it("gives a domainless account its members' domain, logs it, and seeds the company lookup", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_a", "Acme"),
					member("u1", "org_a", "ann@acme.com", "org:admin"),
					member("u2", "org_a", "bo@gmail.com"),
					clerkOrg("org_b", "Solo"),
					member("u3", "org_b", "solo@gmail.com"),
					clerkOrg("org_c", "Verified", ["verified.io"]),
					member("u4", "org_c", "ann@other.io"),
				])
				expect(yield* infer(world)).toBe(1)
				expect(domainsOf(world, "Acme")).toEqual(["acme.com"])
				// Mail providers only: no domain.
				expect(domainsOf(world, "Solo")).toEqual([])
				// A domain a source gave is never second-guessed.
				expect(domainsOf(world, "Verified")).toEqual(["verified.io"])
				expect(
					world.rows(`SELECT title FROM customer_events WHERE type = 'account.domain_inferred'`),
				).toEqual([{ title: "Domain acme.com found from member emails" }])

				// Once is enough: a second turn changes nothing.
				expect(yield* infer(world)).toBe(0)

				yield* world.object.run(seedEnrichments(NOW))
				expect(world.rows(`SELECT domain FROM customer_enrichments ORDER BY domain`)).toEqual([
					{ domain: "acme.com" },
					{ domain: "verified.io" },
				])
			}),
		))

	it("skips a domain in many customers' contacts (staff invited to help)", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ops: Array<IngestOp> = []
				for (let index = 0; index < SHARED_DOMAIN_CUSTOMERS; index++) {
					ops.push(
						clerkOrg(`org_${index}`, `Customer ${index}`),
						member(`staff_${index}`, `org_${index}`, "help@vendor.dev", "org:admin"),
					)
				}
				ops.push(member("founder", "org_0", "founder@zero.co"))
				yield* world.ingest("clerk", ops)
				yield* infer(world)
				expect(domainsOf(world, "Customer 0")).toEqual(["zero.co"])
				expect(domainsOf(world, "Customer 1")).toEqual([])
			}),
		))

	it("never overrules an admin: a changed or removed domain stays as they left it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					clerkOrg("org_a", "Acme"),
					member("u1", "org_a", "ann@acme-old.com"),
				])
				yield* infer(world)
				expect(domainsOf(world, "Acme")).toEqual(["acme-old.com"])
				const accountId = idOf(world, "Acme")
				const update = (payload: { addDomain?: string; removeDomain?: string }) =>
					world.call("customers.account.update", { accountId, ...payload }, world.owner)

				// Swapped in one call: the new one in its place.
				ok(yield* update({ addDomain: "acme.com", removeDomain: "acme-old.com" }))
				expect(domainsOf(world, "Acme")).toEqual(["acme.com"])

				// Removed: the members' domain is not guessed again.
				ok(yield* update({ removeDomain: "acme.com" }))
				expect(domainsOf(world, "Acme")).toEqual([])
				expect(yield* infer(world)).toBe(0)
				expect(domainsOf(world, "Acme")).toEqual([])
			}),
		))
})

describe("customers.account.update removeDomain", () => {
	it("removes a domain as stored, keeps the others, and only an admin may", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [clerkOrg("org_a", "Acme", ["acme.com", "acme.io"])])
				const accountId = idOf(world, "Acme")
				const update = (payload: { addDomain?: string; removeDomain?: string }, user = world.owner) =>
					world.call("customers.account.update", { accountId, ...payload }, user)

				expect(tagOf(yield* update({ removeDomain: "acme.io" }, world.member))).not.toBe("Success")
				// Any form of it: a URL is cleaned as an added one is.
				ok(yield* update({ removeDomain: "https://www.ACME.io/" }))
				expect(domainsOf(world, "Acme")).toEqual(["acme.com"])
				// One it lacks changes nothing, and logs nothing.
				ok(yield* update({ removeDomain: "globex.com" }))
				expect(domainsOf(world, "Acme")).toEqual(["acme.com"])
				expect(
					world.rows(`SELECT type FROM customer_events WHERE type = 'account.domains_changed'`),
				).toHaveLength(1)

				// A swap on a full list frees its own room.
				const full = Array.from({ length: 20 }, (_, index) => `full${index}.com`)
				yield* world.ingest("clerk", [clerkOrg("org_full", "Full", full)])
				const fullId = idOf(world, "Full")
				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: fullId, addDomain: "new.com", removeDomain: "full5.com" },
						world.owner,
					),
				)
				expect(domainsOf(world, "Full")).toEqual([
					"new.com",
					...full.filter((domain) => domain !== "full5.com"),
				])
			}),
		))
})
