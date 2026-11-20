/**
 * SLA policy settings in a `CustomersObject` (`docs/customers/sla.md`): the seeded default, create /
 * update / reorder / delete for admins only, and the org's business hours.
 */
import { storeMigrations } from "@hazel/db"
import { DEFAULT_SLA_POLICY, TEMPLATES } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makeCustomersWorld, ok, tagOf, uuid } from "./test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe("SLA policies", () => {
	it("seeds the standard policy and lets admins order, edit and delete policies", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const policies = () =>
					world.rows<{ name: string; position: number; hours: string }>(
						`SELECT name, position, hours FROM customer_sla_policies WHERE deletedAt IS NULL ORDER BY position`,
					)
				expect(policies()).toEqual([{ name: "Standard", position: 0, hours: "business" }])

				const enterprise = {
					...DEFAULT_SLA_POLICY,
					name: "Enterprise",
					hours: "always" as const,
					appliesTo: { accountIds: [], planNames: ["Enterprise"], tagsAny: [] },
				}
				expect(
					tagOf(
						yield* world.call("customers.slaPolicy.create", { policy: enterprise }, world.member),
					),
				).toBe("UnauthorizedError")
				const created = ok(
					yield* world.call("customers.slaPolicy.create", { policy: enterprise }, world.owner),
				)
				expect(created.data).toMatchObject({ name: "Enterprise", position: 1, hours: "always" })

				const [standard] = world.rows<{ id: string }>(
					`SELECT id FROM customer_sla_policies WHERE name = 'Standard'`,
				)
				// The order names every live policy once.
				expect(
					tagOf(
						yield* world.call(
							"customers.slaPolicy.reorder",
							{ policyIds: [created.data.id] },
							world.owner,
						),
					),
				).toBe("CustomersInvalidRequestError")
				ok(
					yield* world.call(
						"customers.slaPolicy.reorder",
						{ policyIds: [created.data.id, standard!.id] },
						world.owner,
					),
				)
				expect(policies().map((row) => row.name)).toEqual(["Enterprise", "Standard"])

				ok(
					yield* world.call(
						"customers.slaPolicy.update",
						{ policyId: created.data.id, policy: { ...enterprise, warnBeforePct: 50 } },
						world.owner,
					),
				)
				expect(
					world.rows(
						`SELECT warnBeforePct FROM customer_sla_policies WHERE id = '${created.data.id}'`,
					),
				).toEqual([{ warnBeforePct: 50 }])

				ok(
					yield* world.call(
						"customers.slaPolicy.delete",
						{ policyId: created.data.id },
						world.owner,
					),
				)
				expect(policies().map((row) => row.name)).toEqual(["Standard"])
				expect(
					tagOf(
						yield* world.call(
							"customers.slaPolicy.delete",
							{ policyId: created.data.id },
							world.owner,
						),
					),
				).toBe("CustomersNotFoundError")
				expect(
					tagOf(
						yield* world.call(
							"customers.slaPolicy.update",
							{ policyId: uuid(), policy: enterprise },
							world.owner,
						),
					),
				).toBe("CustomersNotFoundError")
			}),
		))

	it("stores the org's business hours", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const businessHours = {
					timeZone: "Europe/Berlin",
					days: [1, 2, 3, 4],
					start: "08:30",
					end: "16:00",
				}
				expect(
					tagOf(
						yield* world.call("customers.businessHours.update", { businessHours }, world.member),
					),
				).toBe("UnauthorizedError")
				ok(yield* world.call("customers.businessHours.update", { businessHours }, world.owner))
				const [row] = world.rows<{ businessHours: string }>(
					`SELECT businessHours FROM customer_settings`,
				)
				expect(JSON.parse(row!.businessHours)).toEqual(businessHours)
			}),
		))

	it("seeds existing orgs (the migration) with the same standard policy", () => {
		const seed = storeMigrations.customers
			.flatMap((migration) => migration.statements)
			.find((statement) => statement.startsWith(`INSERT INTO "customer_sla_policies"`))
		expect(seed).toContain(`'${JSON.stringify(DEFAULT_SLA_POLICY.targets)}'`)
		expect(seed).toContain(`'${DEFAULT_SLA_POLICY.name}', 0, 1`)
		expect(seed).toContain(`'${DEFAULT_SLA_POLICY.hours}', ${DEFAULT_SLA_POLICY.warnBeforePct}`)
	})

	it("seeds existing orgs (the migration) with the two SLA signal rules, at their defaults", () => {
		const statements = storeMigrations.customers.flatMap((migration) => migration.statements)
		for (const template of ["response_overdue", "resolution_overdue"] as const) {
			const meta = TEMPLATES[template]
			const seed = statements.find(
				(statement) =>
					statement.startsWith(`INSERT INTO "customer_signal_rules"`) &&
					statement.includes(`"template" = '${template}'`),
			)
			expect(seed).toContain(`'${JSON.stringify(meta.defaultConfig)}'`)
			expect(seed).toContain(`'${meta.name}', '${template}', '${meta.kind}', '${meta.defaultSeverity}'`)
		}
	})
})
