/**
 * The org's members as its `CustomersObject` sees them (`docs/customers/tech-design.md` §1): a full
 * snapshot of `(userId, role)`, versioned like `channel.setViewers`.
 *
 * - `org.customerMembers` (call): the customers object pulls the snapshot once, when it has none;
 *   answering it marks the org `customersEnabled`.
 * - `publishCustomerMembers`: after a membership or role change, an enabled org pushes the new
 *   snapshot (`customers.setMembers`, outbox). Orgs that never opened Customers send nothing.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { OrganizationId } from "@hazel/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { defineCall } from "../calls"
import { CustomerMember, CustomersEffects } from "../effects/customers-effects"
import { enqueueEffect } from "../effects/registry"
import { customersTarget } from "../kinds"
import { readObjectMeta, writeObjectMeta } from "../meta"

/** Set once the org's customers object pulled its members: from then on changes are pushed. */
const ENABLED_KEY = "customersEnabled"
const VERSION_KEY = "customersMembersVersion"

export const CustomerMembersCall = defineCall("org.customerMembers", "org", {
	payload: Schema.Struct({ organizationId: OrganizationId }),
	success: Schema.Struct({ members: Schema.Array(CustomerMember), version: Schema.Number }),
	error: Schema.Never,
})

const currentMembers = (organizationId: OrganizationId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.from(schema.organizationMembersTable)
				.select("userId", "role")
				.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
		),
	)

/** Past the last version and at least the clock, so it increases across restarts. */
const nextVersion = Effect.gen(function* () {
	const last = Option.getOrElse(Option.map(yield* readObjectMeta(VERSION_KEY), Number), () => 0)
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* writeObjectMeta(VERSION_KEY, String(version))
	return version
})

export const customerMembers = Effect.fn("OrgObject.customerMembers")(function* (payload: {
	readonly organizationId: OrganizationId
}) {
	yield* writeObjectMeta(ENABLED_KEY, "1")
	const members = yield* currentMembers(payload.organizationId)
	return { members, version: yield* nextVersion }
}, Effect.orDie)

/** Push the members snapshot to the org's customers object, once it exists. Inside the handler's transaction. */
export const publishCustomerMembers = Effect.fn("OrgObject.publishCustomerMembers")(function* (
	organizationId: OrganizationId,
) {
	const enabled = yield* readObjectMeta(ENABLED_KEY).pipe(Effect.mapError(Database.toDatabaseError))
	if (Option.isNone(enabled)) return
	const members = yield* currentMembers(organizationId)
	yield* enqueueEffect(CustomersEffects.setMembers, customersTarget(organizationId), {
		organizationId,
		members,
		version: yield* nextVersion.pipe(Effect.mapError(Database.toDatabaseError)),
	})
})
