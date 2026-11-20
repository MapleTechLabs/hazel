/**
 * Support SLA settings (`docs/customers/sla.md`): policies and the org's business hours. Admins and
 * owners only. A change applies to issues opened (or re-targeted) after it; running clocks keep
 * their deadlines.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CustomerSlaRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { requireAdmin, requireOwnOrganization } from "../../worker/objects/customers/access"
import { currentTime, invalid, notFound, remap, txOnly, withTx } from "./customers"

export const CustomerSlaRpcLive = CustomerSlaRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database

		const livePolicies = db.run(
			SQLite.from(schema.customerSlaPoliciesTable)
				.select("id", "position")
				.where(($) => [$.deletedAt.isNull()])
				.orderBy(($) => [[$.position, "asc"]]),
		)

		return {
			"customers.slaPolicy.create": ({ policy, organizationId: payloadOrg }) =>
				Effect.gen(function* () {
					const organizationId = yield* requireOwnOrganization(payloadOrg)
					const actor = yield* requireAdmin
					return yield* withTx(
						Effect.gen(function* () {
							const last = (yield* livePolicies).at(-1)
							const [row] = yield* db.run(
								SQLite.insertInto(schema.customerSlaPoliciesTable)
									.values({
										organizationId,
										...policy,
										position: (last?.position ?? -1) + 1,
										createdBy: actor.userId,
										updatedBy: actor.userId,
									})
									.returning(),
							)
							if (row === undefined)
								return yield* Effect.die(new Error("Insert returned no row"))
							return row
						}),
					)
				}).pipe(Effect.withSpan("CustomerSla.policyCreate"), remap),

			"customers.slaPolicy.update": ({ policyId, policy }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					const now = yield* currentTime
					return yield* withTx(
						Effect.gen(function* () {
							const [row] = yield* db.run(
								SQLite.update(schema.customerSlaPoliciesTable)
									.set({ ...policy, updatedBy: actor.userId, updatedAt: now })
									.where(($) => [$.id.eq(policyId), $.deletedAt.isNull()])
									.returning(),
							)
							if (row === undefined) return yield* notFound("sla_policy", policyId)
							return row
						}),
					)
				}).pipe(Effect.withSpan("CustomerSla.policyUpdate"), remap),

			"customers.slaPolicy.delete": ({ policyId }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const [row] = yield* db.run(
								SQLite.update(schema.customerSlaPoliciesTable)
									.set({ deletedAt: now, updatedAt: now })
									.where(($) => [$.id.eq(policyId), $.deletedAt.isNull()])
									.returning("id"),
							)
							if (row === undefined) return yield* notFound("sla_policy", policyId)
						}),
					)
				}).pipe(Effect.withSpan("CustomerSla.policyDelete"), remap),

			"customers.slaPolicy.reorder": ({ policyIds }) =>
				Effect.gen(function* () {
					yield* requireAdmin
					const now = yield* currentTime
					return yield* txOnly(
						Effect.gen(function* () {
							const live = new Set((yield* livePolicies).map((row) => row.id))
							if (policyIds.length !== live.size || !policyIds.every((id) => live.has(id)))
								return yield* invalid("The order must name every policy exactly once")
							yield* Effect.forEach(policyIds, (id, position) =>
								db.run(
									SQLite.update(schema.customerSlaPoliciesTable)
										.set({ position, updatedAt: now })
										.where(($) => [$.id.eq(id), $.position.neq(position)]),
								),
							)
						}),
					)
				}).pipe(Effect.withSpan("CustomerSla.policyReorder"), remap),

			"customers.businessHours.update": ({ businessHours }) =>
				Effect.gen(function* () {
					const actor = yield* requireAdmin
					const now = yield* currentTime
					return yield* txOnly(
						db.run(
							SQLite.update(schema.customerSettingsTable)
								.set({ businessHours, updatedBy: actor.userId, updatedAt: now })
								.allRows(),
						),
					)
				}).pipe(Effect.withSpan("CustomerSla.businessHoursUpdate"), remap),
		}
	}),
)
