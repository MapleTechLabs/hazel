/**
 * The org's members as its `CustomersObject` sees them (`docs/customers/tech-design.md` §1): a full
 * snapshot of `(userId, role)`, versioned like `channel.setViewers`.
 *
 * - `org.customerMembers` (call): the customers object pulls the snapshot once, when it has none;
 *   answering it marks the org `customersEnabled`. An object with no live organization row (an
 *   unknown or deleted org) answers `null` and stays disabled.
 * - `publishCustomerMembers`: after a membership or role change, an enabled org pushes the new
 *   snapshot (`customers.setMembers`, outbox). Orgs that never opened Customers send nothing.
 * - `publishCustomersOrganizationDeleted`: the org was deleted; its customers object drops every
 *   member, disconnects its data sources and stops computing.
 *
 * Members are people: bots' machine users (org members since their install) are left out.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { OrganizationId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { defineCall } from "../calls"
import { inList } from "../customers/sql"
import { CustomerMember, CustomersEffects } from "../effects/customers-effects"
import { enqueueEffect } from "../effects/registry"
import { customersTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"

/** Set once the org's customers object pulled its members: from then on changes are pushed. */
const ENABLED_KEY = "customersEnabled"
const VERSION_KEY = "customersMembersVersion"

export const CustomerMembersCall = defineCall("org.customerMembers", "org", {
	payload: Schema.Struct({ organizationId: OrganizationId }),
	success: Schema.NullOr(Schema.Struct({ members: Schema.Array(CustomerMember), version: Schema.Number })),
	error: Schema.Never,
})

const currentMembers = Effect.fn("OrgObject.currentCustomerMembers")(function* (
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const members = yield* db.run(
		SQLite.from(schema.organizationMembersTable)
			.select("userId", "role")
			.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
	)
	if (members.length === 0) return members
	const machines = yield* db.run(
		SQLite.from(schema.usersTable)
			.select("id")
			.where(($) => [
				inList(
					$.id,
					members.map((member) => member.userId),
				),
				$.userType.eq("machine"),
			]),
	)
	const bots = new Set(machines.map((machine) => machine.id))
	return members.filter((member) => !bots.has(member.userId))
})

/** Past the last version and at least the clock, so it increases across restarts. */
const nextVersion = Effect.gen(function* () {
	const last = Option.getOrElse(Option.map(yield* readObjectMeta(VERSION_KEY), Number), () => 0)
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* writeObjectMeta(VERSION_KEY, String(version))
	return version
})

const isLive = Effect.fn("OrgObject.isLiveOrganization")(function* (organizationId: OrganizationId) {
	const db = yield* Database.Database
	const organization = yield* db.first(
		SQLite.from(schema.organizationsTable)
			.select("id")
			.where(($) => [$.id.eq(organizationId), $.deletedAt.isNull()])
			.limit(1),
	)
	return Option.isSome(organization)
})

export const customerMembers = Effect.fn("OrgObject.customerMembers")(function* (payload: {
	readonly organizationId: OrganizationId
}) {
	if (!(yield* isLive(payload.organizationId))) return null
	const members = yield* currentMembers(payload.organizationId)
	yield* writeObjectMeta(ENABLED_KEY, "1")
	return { members, version: yield* nextVersion }
}, Effect.orDie)

/**
 * Push the members snapshot to the org's customers object, once it exists and while the org is live
 * (a deleted org's object got its final, empty snapshot). Inside the handler's transaction.
 */
export const publishCustomerMembers = Effect.fn("OrgObject.publishCustomerMembers")(function* (
	organizationId: OrganizationId,
) {
	const enabled = yield* readObjectMeta(ENABLED_KEY).pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.isNone(enabled) || !(yield* isLive(organizationId))) return
	const members = yield* currentMembers(organizationId)
	yield* enqueueEffect(CustomersEffects.setMembers, customersTarget(organizationId), {
		organizationId,
		members,
		version: yield* nextVersion.pipe(Effect.mapError(Database.toDatabaseError)),
	})
})

/** The org was deleted: its customers object (if it has one) shuts down. Inside the delete's transaction. */
export const publishCustomersOrganizationDeleted = Effect.fn("OrgObject.publishCustomersOrganizationDeleted")(
	function* (organizationId: OrganizationId) {
		const enabled = yield* readObjectMeta(ENABLED_KEY).pipe(Effect.mapError(Database.toDatabaseError))
		if (Option.isNone(enabled)) return
		yield* enqueueEffect(CustomersEffects.setMembers, customersTarget(organizationId), {
			organizationId,
			members: [],
			organizationDeleted: true,
			version: yield* nextVersion.pipe(Effect.mapError(Database.toDatabaseError)),
		})
	},
)
