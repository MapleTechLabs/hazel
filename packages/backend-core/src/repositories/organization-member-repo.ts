import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { OrganizationMember } from "@hazel/domain/models"
import { Context, DateTime, Effect, Layer, type Schema } from "effect"

/** Timestamp columns take a `Date`; domain models carry `Date | DateTime.Utc`. */
const toDate = (value: Date | DateTime.Utc): Date =>
	DateTime.isDateTime(value) ? DateTime.toDate(value) : value
const toNullableDate = (value: Date | DateTime.Utc | null): Date | null =>
	value === null ? null : toDate(value)

export class OrganizationMemberRepo extends Context.Service<OrganizationMemberRepo>()(
	"OrganizationMemberRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.organizationMembersTable,
				{ insert: OrganizationMember.Insert, update: OrganizationMember.Update },
				{
					idColumn: "id",
					name: "OrganizationMember",
				},
			)
			const db = yield* Database.Database

			const findByOrgAndUser = (organizationId: OrganizationId, userId: UserId) =>
				db.first(
					SQLite.from(schema.organizationMembersTable)
						.select()
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.userId.eq(userId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			const upsertByOrgAndUser = (data: Schema.Schema.Type<typeof OrganizationMember.Insert>) =>
				// Atomic upsert using onConflictDoUpdate to avoid race conditions
				db
					.run(
						SQLite.insertInto(schema.organizationMembersTable)
							.values({
								organizationId: data.organizationId,
								userId: data.userId,
								role: data.role,
								nickname: data.nickname,
								joinedAt: toDate(data.joinedAt),
								invitedBy: data.invitedBy,
								deletedAt: toNullableDate(data.deletedAt),
							})
							.onConflictDoUpdate({
								target: ["organizationId", "userId"],
								set: {
									role: data.role,
									deletedAt: null,
								},
							})
							.returning(),
					)
					.pipe(Effect.map((results) => results[0]))

			const findAllByOrganization = (organizationId: OrganizationId) =>
				db.run(
					SQLite.from(schema.organizationMembersTable)
						.select()
						.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
				)

			const softDelete = (id: OrganizationMemberId) =>
				db.run(
					SQLite.update(schema.organizationMembersTable)
						.set({ deletedAt: new Date() })
						.where(($) => [$.id.eq(id), $.deletedAt.isNull()]),
				)

			const updateMetadata = (id: OrganizationMemberId, metadata: Record<string, any>) =>
				db.first(
					SQLite.update(schema.organizationMembersTable)
						.set({ metadata })
						.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
						.returning(),
				)

			return {
				...baseRepo,
				findByOrgAndUser,
				upsertByOrgAndUser,
				findAllByOrganization,
				softDelete,
				updateMetadata,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
