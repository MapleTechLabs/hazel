/**
 * `customers.account.link`, `unlink`, `setPrimary` and `setEnvironment` on node SQLite: accounts
 * stay their own rows and link into a group with one primary, whose signals stand for the group.
 */
import type { UpsertAccount } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { runCompute } from "./compute"
import { type CustomersWorld, makeCustomersWorld, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const clerkOrg = (id: string, name: string): UpsertAccount => ({
	_tag: "account",
	externalId: id,
	name,
	domains: [`${id}.com`],
	sameAs: [],
	onNoMatch: "create",
})

/** Three Clerk organizations of one customer, as accounts. */
const setup = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", [
		clerkOrg("org_us", "Acme US"),
		clerkOrg("org_eu", "Acme EU"),
		clerkOrg("org_ap", "Acme AP"),
	])
	const idOf = (name: string) =>
		world.rows<{ id: CustomerAccountId }>(`SELECT id FROM customer_accounts WHERE name = ?`, name)[0]!.id
	return { world, us: idOf("Acme US"), eu: idOf("Acme EU"), ap: idOf("Acme AP") }
})

const groupOf = (world: CustomersWorld) =>
	Object.fromEntries(
		world
			.rows<{ name: string; primary: string | null }>(
				`SELECT a.name, p.name AS "primary" FROM customer_accounts AS a
				LEFT JOIN customer_accounts AS p ON p.id = a.primaryAccountId ORDER BY a.name`,
			)
			.map((row) => [row.name, row.primary]),
	)

const signal = (world: CustomersWorld, accountId: string, status = "open") => {
	const id = uuid()
	world.rows(
		`INSERT INTO customer_signals (id, organizationId, accountId, ruleId, template, kind, severity,
		status, title, reason, evidence, openingEvidence) VALUES (?, ?, ?, ?, 'inactive', 'risk', 'high', ?,
		'Quiet', 'Quiet', '{}', '{}')`,
		id,
		world.orgId,
		accountId,
		uuid(),
		status,
	)
	return id
}

const signalOf = (world: CustomersWorld, id: string) =>
	world.rows(
		`SELECT accountId, status, closedAt IS NOT NULL AS closed, resolvedAt IS NOT NULL AS resolved
		FROM customer_signals WHERE id = ?`,
		id,
	)[0]

describe("customer groups", () => {
	it("links an account under a primary and closes its unclosed signals", () =>
		run(
			Effect.gen(function* () {
				const { world, us, eu, ap } = yield* setup
				const open = signal(world, eu)
				const snoozed = signal(world, eu, "snoozed")
				const dismissed = signal(world, eu, "dismissed")
				const primaryOwn = signal(world, us)
				world.rows(`UPDATE customer_accounts SET openRiskHigh = 3 WHERE id = ?`, eu)

				expect(
					tagOf(
						yield* world.call(
							"customers.account.link",
							{ accountId: eu, primaryAccountId: us },
							world.member,
						),
					),
				).toBe("UnauthorizedError")
				expect(
					tagOf(
						yield* world.call(
							"customers.account.link",
							{ accountId: eu, primaryAccountId: eu },
							world.owner,
						),
					),
				).toBe("CustomerGroupError")
				expect(
					tagOf(
						yield* world.call(
							"customers.account.link",
							{ accountId: eu, primaryAccountId: uuid() },
							world.owner,
						),
					),
				).toBe("CustomersNotFoundError")

				const result = yield* world.call(
					"customers.account.link",
					{ accountId: eu, primaryAccountId: us },
					world.owner,
				)
				expect(tagOf(result)).toBe("Success")
				expect(groupOf(world)).toEqual({ "Acme AP": null, "Acme EU": "Acme US", "Acme US": null })
				expect(signalOf(world, open)).toEqual({
					accountId: eu,
					status: "auto_resolved",
					closed: 1,
					resolved: 1,
				})
				expect(signalOf(world, snoozed)).toEqual({
					accountId: eu,
					status: "auto_resolved",
					closed: 1,
					resolved: 1,
				})
				expect(signalOf(world, dismissed)).toEqual({
					accountId: eu,
					status: "dismissed",
					closed: 1,
					resolved: 0,
				})
				expect(signalOf(world, primaryOwn)).toEqual({
					accountId: us,
					status: "open",
					closed: 0,
					resolved: 0,
				})
				expect(world.rows(`SELECT openRiskHigh FROM customer_accounts WHERE id = ?`, eu)).toEqual([
					{ openRiskHigh: 0 },
				])
				expect(
					world.rows(
						`SELECT accountId, type FROM customer_events WHERE type = 'account.linked' ORDER BY title`,
					),
				).toEqual(
					expect.arrayContaining([
						{ accountId: eu, type: "account.linked" },
						{ accountId: us, type: "account.linked" },
					]),
				)

				// An environment cannot be a primary: no chains.
				expect(
					tagOf(
						yield* world.call(
							"customers.account.link",
							{ accountId: ap, primaryAccountId: eu },
							world.owner,
						),
					),
				).toBe("CustomerGroupError")
			}),
		))

	it("links a group under another primary, its environments with it", () =>
		run(
			Effect.gen(function* () {
				const { world, us, eu, ap } = yield* setup
				yield* world.call(
					"customers.account.link",
					{ accountId: ap, primaryAccountId: eu },
					world.owner,
				)
				const groupSignal = signal(world, eu)
				expect(groupOf(world)).toEqual({ "Acme AP": "Acme EU", "Acme EU": null, "Acme US": null })

				const result = yield* world.call(
					"customers.account.link",
					{ accountId: eu, primaryAccountId: us },
					world.owner,
				)
				expect(tagOf(result)).toBe("Success")
				expect(groupOf(world)).toEqual({
					"Acme AP": "Acme US",
					"Acme EU": "Acme US",
					"Acme US": null,
				})
				expect(signalOf(world, groupSignal)).toMatchObject({ status: "auto_resolved", closed: 1 })
			}),
		))

	it("unlinks an environment; refuses a primary with environments", () =>
		run(
			Effect.gen(function* () {
				const { world, us, eu, ap } = yield* setup
				yield* world.call(
					"customers.account.link",
					{ accountId: eu, primaryAccountId: us },
					world.owner,
				)

				expect(
					tagOf(yield* world.call("customers.account.unlink", { accountId: us }, world.owner)),
				).toBe("CustomerGroupError")
				// A standalone account is left as it is.
				expect(
					tagOf(yield* world.call("customers.account.unlink", { accountId: ap }, world.owner)),
				).toBe("Success")
				expect(
					tagOf(yield* world.call("customers.account.unlink", { accountId: eu }, world.owner)),
				).toBe("Success")
				expect(groupOf(world)).toEqual({ "Acme AP": null, "Acme EU": null, "Acme US": null })
				expect(
					world
						.rows<{ accountId: string }>(
							`SELECT accountId FROM customer_events WHERE type = 'account.unlinked'`,
						)
						.map((row) => row.accountId)
						.sort(),
				).toEqual([eu, us].sort())
				// A primary whose environments left stands alone: unlinking it changes nothing.
				expect(
					tagOf(yield* world.call("customers.account.unlink", { accountId: us }, world.owner)),
				).toBe("Success")
			}),
		))

	it("releases the environments of a primary a sync deleted at the next compute", () =>
		run(
			Effect.gen(function* () {
				const { world, us, eu } = yield* setup
				yield* world.call(
					"customers.account.link",
					{ accountId: eu, primaryAccountId: us },
					world.owner,
				)
				world.rows(
					`UPDATE customer_accounts SET deletedAt = '2026-01-01 00:00:00.000' WHERE id = ?`,
					us,
				)
				yield* world.object.run(runCompute(new Date())).pipe(Effect.orDie)
				expect(groupOf(world)).toEqual({ "Acme AP": null, "Acme EU": null, "Acme US": null })
			}),
		))

	it("moves the primary and the group's unclosed signals", () =>
		run(
			Effect.gen(function* () {
				const { world, us, eu, ap } = yield* setup
				yield* world.call(
					"customers.account.link",
					{ accountId: eu, primaryAccountId: us },
					world.owner,
				)
				yield* world.call(
					"customers.account.link",
					{ accountId: ap, primaryAccountId: us },
					world.owner,
				)
				const open = signal(world, us)
				const closed = signal(world, us)
				world.rows(
					`UPDATE customer_signals SET closedAt = '2026-01-01T00:00:00.000Z' WHERE id = ?`,
					closed,
				)
				world.rows(`UPDATE customer_accounts SET openRiskHigh = 1 WHERE id = ?`, us)

				const result = yield* world.call(
					"customers.account.setPrimary",
					{ accountId: eu },
					world.owner,
				)
				expect(tagOf(result)).toBe("Success")
				expect(groupOf(world)).toEqual({
					"Acme AP": "Acme EU",
					"Acme EU": null,
					"Acme US": "Acme EU",
				})
				expect(signalOf(world, open)).toMatchObject({ accountId: eu, status: "open", closed: 0 })
				expect(signalOf(world, closed)).toMatchObject({ accountId: us })
				expect(world.rows(`SELECT name, openRiskHigh FROM customer_accounts ORDER BY name`)).toEqual([
					{ name: "Acme AP", openRiskHigh: 0 },
					{ name: "Acme EU", openRiskHigh: 1 },
					{ name: "Acme US", openRiskHigh: 0 },
				])

				// Already primary: nothing changes.
				expect(
					tagOf(yield* world.call("customers.account.setPrimary", { accountId: eu }, world.owner)),
				).toBe("Success")
				expect(groupOf(world)).toEqual({
					"Acme AP": "Acme EU",
					"Acme EU": null,
					"Acme US": "Acme EU",
				})
				expect(
					world.rows(
						`SELECT count(*) AS n FROM customer_events WHERE type = 'account.primary_changed'`,
					),
				).toEqual([{ n: 2 }])
			}),
		))

	it("names an environment; blank clears it", () =>
		run(
			Effect.gen(function* () {
				const { world, eu } = yield* setup
				const environment = () =>
					world.rows(`SELECT environment FROM customer_accounts WHERE id = ?`, eu)[0]
				expect(
					tagOf(
						yield* world.call(
							"customers.account.setEnvironment",
							{ accountId: eu, environment: "EU" },
							world.member,
						),
					),
				).toBe("UnauthorizedError")
				yield* world.call(
					"customers.account.setEnvironment",
					{ accountId: eu, environment: " EU " },
					world.owner,
				)
				expect(environment()).toEqual({ environment: "EU" })
				yield* world.call(
					"customers.account.setEnvironment",
					{ accountId: eu, environment: "  " },
					world.owner,
				)
				expect(environment()).toEqual({ environment: null })
				yield* world.call(
					"customers.account.setEnvironment",
					{ accountId: eu, environment: "Europe" },
					world.owner,
				)
				yield* world.call(
					"customers.account.setEnvironment",
					{ accountId: eu, environment: null },
					world.owner,
				)
				expect(environment()).toEqual({ environment: null })
				expect(
					world.rows(
						`SELECT title FROM customer_events WHERE type = 'account.environment_changed' ORDER BY occurredAt, rowid`,
					),
				).toEqual([
					{ title: "Environment: EU" },
					{ title: "Environment cleared" },
					{ title: "Environment: Europe" },
					{ title: "Environment cleared" },
				])
				expect(
					tagOf(
						yield* world.call(
							"customers.account.setEnvironment",
							{ accountId: uuid(), environment: "EU" },
							world.owner,
						),
					),
				).toBe("CustomersNotFoundError")
			}),
		))
})
