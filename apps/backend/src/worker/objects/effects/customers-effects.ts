/**
 * Effects a `CustomersObject` receives (`docs/customers/tech-design.md` §1): its org's members,
 * projected by the `OrgObject` whenever a membership or role changes, and pulled once by the
 * customers object itself when it has none (`org.customerMembers`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { defineEffect, type EffectReceivers, type EffectSender, isOrgSender } from "./registry"

export const CustomerMember = Schema.Struct({
	userId: UserId,
	role: Schema.Literals(["owner", "admin", "member"]),
})
export type CustomerMember = typeof CustomerMember.Type

/** Every current member: a full snapshot, so a missed one is repaired by the next. */
export const SetMembersPayload = Schema.Struct({
	organizationId: OrganizationId,
	members: Schema.Array(CustomerMember),
	/** Increases with every snapshot the org sends (out-of-order deliveries drop the older one). */
	version: Schema.Number,
})
export type SetMembersPayload = typeof SetMembersPayload.Type

export const CustomersEffects = {
	setMembers: defineEffect("customers.setMembers", "customers", SetMembersPayload),
}

/** The `version` of the last applied `setMembers`. */
export const CUSTOMERS_MEMBERS_VERSION_KEY = "membersVersion"

/** Replace `customer_members` with `members`, writing only what changed. */
export const applyMembers = Effect.fn("CustomersEffects.applyMembers")(function* (
	members: ReadonlyArray<CustomerMember>,
) {
	const db = yield* Database.Database
	const current = yield* db.run(SQLite.from(schema.customerMembersTable).select())
	const next = new Map(members.map((member) => [member.userId, member.role]))
	const gone = current.filter((row) => !next.has(row.userId)).map((row) => row.userId)
	if (gone.length > 0) {
		yield* db.run(SQLite.deleteFrom(schema.customerMembersTable).where(($) => [$.userId.in_(...gone)]))
	}
	const roles = new Map(current.map((row) => [row.userId, row.role]))
	for (const member of members) {
		if (roles.get(member.userId) === member.role) continue
		yield* db.run(
			SQLite.insertInto(schema.customerMembersTable)
				.values(member)
				.onConflictDoUpdate({ target: ["userId"], set: { role: member.role } }),
		)
	}
})

export const customersReceivers = {
	"customers.setMembers": (payload) =>
		Effect.gen(function* () {
			const applied = Option.map(yield* readObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY), Number)
			if (Option.isSome(applied) && payload.version < applied.value) return
			yield* writeObjectMeta(CUSTOMERS_MEMBERS_VERSION_KEY, String(payload.version))
			yield* applyMembers(payload.members)
		}),
} satisfies EffectReceivers<typeof CustomersEffects, Database.Database | SqlClient>

/** Only this org's `OrgObject` sends members, and only to its own customers object. */
export const customersSenderRefusal = (kind: string, payload: unknown, sender: EffectSender) =>
	Effect.gen(function* () {
		if (kind !== CustomersEffects.setMembers.name) return Option.none<string>()
		const { organizationId } = payload as SetMembersPayload
		const self = yield* readObjectMeta("id").pipe(Effect.orDie)
		return isOrgSender(sender, organizationId) && Option.getOrUndefined(self) === organizationId
			? Option.none<string>()
			: Option.some(`${kind} for org ${organizationId} from ${sender.kind}`)
	})
