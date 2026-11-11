/**
 * `org.acceptInvitation`: the org side of `invitation.accept`. The api Worker checks the token,
 * status and email against the directory's `organization_invitations`, sends this (keyed by the
 * invitation, so a retried accept is applied once), then marks the invitation accepted.
 *
 * Adds the user as a member (or reactivates a removed one) with the invited role, joins them to
 * `#general` like a public-link join, copies their directory row, and resyncs their access
 * (`syncMemberAccess`: channel projections, `membership_index`, `user_organizations`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Effect, Option } from "effect"
import type { AcceptInvitationPayload } from "../directory-wire"
import { syncMemberAccess } from "./channel-access"
import { upsertUserProjection } from "./projections"

export const acceptInvitation = Effect.fn("OrgObject.acceptInvitation")(function* (
	payload: AcceptInvitationPayload,
) {
	const db = yield* Database.Database
	const { organizationId } = payload
	const userId = payload.user.id
	yield* Effect.annotateCurrentSpan({ "invitation.id": payload.invitationId, "user.id": userId })

	const organization = yield* db.first(
		SQLite.from(schema.organizationsTable)
			.select("id")
			.where(($) => [$.id.eq(organizationId), $.deletedAt.isNull()])
			.limit(1),
	)
	// The Worker checked the org index; a deleted org has nothing to join.
	if (Option.isNone(organization)) return

	yield* upsertUserProjection(payload.user)

	const existing = yield* db.first(
		SQLite.from(schema.organizationMembersTable)
			.select("deletedAt")
			.where(($) => [$.organizationId.eq(organizationId), $.userId.eq(userId)])
			.limit(1),
	)
	// Already a member: the invitation adds nothing (their role stays).
	if (Option.isSome(existing) && existing.value.deletedAt === null) return

	const now = new Date()
	yield* db.run(
		SQLite.insertInto(schema.organizationMembersTable)
			.values({
				organizationId,
				userId,
				role: payload.role,
				joinedAt: now,
				invitedBy: payload.invitedBy,
			})
			.onConflictDoUpdate({
				target: ["organizationId", "userId"],
				set: { role: payload.role, joinedAt: now, invitedBy: payload.invitedBy, deletedAt: null },
			}),
	)

	const general = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.organizationId.eq(organizationId), $.name.eq("general"), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isSome(general)) {
		const membership = yield* db.first(
			SQLite.from(schema.channelMembersTable)
				.select("id", "deletedAt")
				.where(($) => [$.channelId.eq(general.value.id), $.userId.eq(userId)])
				.limit(1),
		)
		if (Option.isNone(membership)) {
			yield* db.run(
				SQLite.insertInto(schema.channelMembersTable).values({
					channelId: general.value.id,
					userId,
					joinedAt: now,
				}),
			)
		} else if (membership.value.deletedAt !== null) {
			yield* db.run(
				SQLite.update(schema.channelMembersTable)
					.set({ deletedAt: null, joinedAt: now })
					.where(($) => [$.id.eq(membership.value.id)]),
			)
		}
	}

	yield* syncMemberAccess(userId, organizationId)
})
