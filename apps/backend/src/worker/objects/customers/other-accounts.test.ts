/** `customers.contacts.list`: which other customers a user also belongs to. */
import type { UpsertAccount, UpsertContact } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { type CustomersWorld, makeCustomersWorld, ok } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const org = (id: string, name: string): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [`${id}.com`],
	sameAs: [],
	onNoMatch: "create",
})

const member = (id: string, orgId: string, fields: Partial<UpsertContact> = {}): UpsertContact => ({
	_tag: "contact",
	externalId: id,
	account: { provider: "clerk", externalId: orgId },
	email: `${id}@${orgId}.com`,
	name: id,
	...fields,
})

const accountId = (world: CustomersWorld, name: string) =>
	world.rows<{ id: CustomerAccountId }>(`SELECT id FROM customer_accounts WHERE name = ?`, name)[0]!.id

const otherNames = (world: CustomersWorld, account: string, contact: string) =>
	Effect.gen(function* () {
		const page = ok(
			yield* world.call(
				"customers.contacts.list",
				{ accountId: accountId(world, account) },
				world.member,
			),
		)
		const row = page.items.find((item: { contact: { name: string } }) => item.contact.name === contact)
		return row.otherAccounts.map((other: { name: string }) => other.name)
	})

describe("a user's other customers", () => {
	it("finds the same sign-in user in another org, and not after they leave it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					org("org_a", "Acme"),
					org("org_b", "Globex"),
					member("user_1", "org_a", { email: "one@acme.com" }),
					member("user_1", "org_b", { email: "one@globex.com" }),
					member("user_2", "org_a"),
				])
				expect(yield* otherNames(world, "Acme", "user_1")).toEqual(["Globex"])
				expect(yield* otherNames(world, "Globex", "user_1")).toEqual(["Acme"])
				expect(yield* otherNames(world, "Acme", "user_2")).toEqual([])

				yield* world.ingest("clerk", [member("user_1", "org_b", { removed: true })])
				expect(yield* otherNames(world, "Acme", "user_1")).toEqual([])
			}),
		))

	it("matches the same email in any case across different sign-in users", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", [
					org("org_a", "Acme"),
					org("org_b", "Globex"),
					member("user_1", "org_a", { email: "Sam@Shared.io" }),
					member("user_2", "org_b", { email: "sam@shared.io" }),
				])
				expect(yield* otherNames(world, "Acme", "user_1")).toEqual(["Globex"])
			}),
		))
})
