import { Database, SQLite, schema } from "@hazel/db"
import type { InvitationId, OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"

const table = schema.organizationInvitationsTable
export interface NewInvitation {
	readonly organizationId: OrganizationId
	readonly email: string
	readonly role: "admin" | "member"
	readonly tokenHash: string
	readonly invitedBy: UserId
	readonly expiresAt: Date
}

export class InvitationRepo extends Context.Service<InvitationRepo>()("InvitationRepo", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database
		const upsertPending = (data: NewInvitation) =>
			db
				.run(
					SQLite.insertInto(table)
						.values({ ...data, status: "pending" })
						.onConflictDoUpdate({
							target: ["organizationId", "email"],
							targetWhere: ($) => $.status.eq("pending"),
							set: {
								role: data.role,
								tokenHash: data.tokenHash,
								invitedBy: data.invitedBy,
								expiresAt: data.expiresAt,
								updatedAt: new Date(),
							},
						})
						.returning(),
				)
				.pipe(Effect.map((rows) => rows[0]!))
		const listPending = (organizationId: OrganizationId, now: Date) =>
			db.run(
				SQLite.from(table)
					.select()
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.status.eq("pending"),
						$.expiresAt.gt(now),
					])
					.orderBy(["createdAt", "desc"]),
			)
		const findById = (id: InvitationId) =>
			db.first(
				SQLite.from(table)
					.select()
					.where(($) => [$.id.eq(id)])
					.limit(1),
			)
		const findByTokenHash = (hash: string) =>
			db.first(
				SQLite.from(table)
					.select()
					.where(($) => [$.tokenHash.eq(hash)])
					.limit(1),
			)
		const revoke = (id: InvitationId, expectedTokenHash?: string) =>
			db.first(
				SQLite.update(table)
					.set({ status: "revoked", updatedAt: new Date() })
					.where(($) => [
						$.id.eq(id),
						$.status.eq("pending"),
						expectedTokenHash === undefined ? undefined : $.tokenHash.eq(expectedTokenHash),
					])
					.returning(),
			)
		const markAccepted = (id: InvitationId, userId: UserId, expectedTokenHash: string) =>
			db.first(
				SQLite.update(table)
					.set({
						status: "accepted",
						acceptedBy: userId,
						acceptedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(id), $.status.eq("pending"), $.tokenHash.eq(expectedTokenHash)])
					.returning(),
			)
		const findMemberEmails = (organizationId: OrganizationId, emails: ReadonlyArray<string>) =>
			db
				.run(
					SQLite.from(schema.organizationMembersTable, "members")
						.innerJoin(schema.usersTable, "users", (members, users) =>
							users.id.eq(members.userId),
						)
						.select(($) => ({ email: SQLite.lower($.users.email) }))
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.deletedAt.isNull(),
							SQLite.inList(SQLite.lower($.users.email) as SQLite.Expr<string>, [...emails]),
						]),
				)
				.pipe(Effect.map((rows) => new Set(rows.map((row) => row.email))))
		return {
			upsertPending,
			listPending,
			findById,
			findByTokenHash,
			revoke,
			markAccepted,
			findMemberEmails,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
