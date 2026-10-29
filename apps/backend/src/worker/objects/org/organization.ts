/**
 * The `OrgObject`'s own organization row and its directory projection (`org_index`), plus the
 * cascade of an organization delete to its members' `membership_index` and `user_organizations`.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { type OrganizationId, OrganizationId as OrganizationIdSchema } from "@hazel/schema"
import { Effect, Option } from "effect"
import { currentObject } from "../../../lib/current-object"
import { DirectoryEffects } from "../effects/directory-effects"
import { enqueueEffect } from "../effects/registry"
import { UserEffects } from "../effects/user-effects"
import { userTarget } from "../kinds"

/** Project the organization's row to `org_index` (routing, slug lookups, public joins). */
export const publishOrgIndex = Effect.fn("OrgObject.publishOrgIndex")(function* (
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const org = yield* db.first(
		SQLite.from(schema.organizationsTable)
			.select("id", "slug", "name", "isPublic", "deletedAt")
			.where(($) => [$.id.eq(organizationId)])
			.limit(1),
	)
	if (Option.isNone(org)) return
	const { deletedAt, ...row } = org.value
	yield* enqueueEffect(
		DirectoryEffects.upsertOrgIndex,
		{ kind: "directory" },
		{ ...row, deletedAt: deletedAt === null ? null : deletedAt.toISOString() },
	)
})

/** The organization is gone: every member leaves it in the directory and their `UserObject`. */
export const publishOrgRemoval = Effect.fn("OrgObject.publishOrgRemoval")(function* (
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const members = yield* db.run(
		SQLite.from(schema.organizationMembersTable)
			.select("userId")
			.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
	)
	const deletedAt = new Date().toISOString()
	yield* Effect.forEach(
		members,
		({ userId }) =>
			Effect.all([
				enqueueEffect(
					DirectoryEffects.upsertMembershipIndex,
					{ kind: "directory" },
					{ userId, organizationId, deletedAt },
				),
				enqueueEffect(UserEffects.setOrganization, userTarget(userId), { organizationId, deletedAt }),
			]),
		{ discard: true },
	)
	yield* publishOrgIndex(organizationId)
	yield* Effect.annotateCurrentSpan({ "org.members_removed": members.length })
})

/**
 * The organization a `listByOrganization`-style call is about: the `OrgObject` it landed in (the
 * api Worker routed it by its `organizationId` hint), else the session's active organization.
 */
export const requestOrganizationId = Effect.gen(function* () {
	const object = yield* currentObject
	if (Option.isSome(object) && object.value.kind === "org") {
		return Option.some(OrganizationIdSchema.make(object.value.id))
	}
	const user = yield* CurrentUser.Context
	return Option.fromNullishOr(user.organizationId)
})
