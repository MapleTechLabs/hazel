import { Database, SQLite, Repository, schema } from "@hazel/db"
import type { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { ConnectInvite } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ConnectInviteRepo extends Context.Service<ConnectInviteRepo>()("ConnectInviteRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.connectInvitesTable,
			{ insert: ConnectInvite.Insert, update: ConnectInvite.Update },
			{
				idColumn: "id",
				name: "ConnectInvite",
			},
		)
		const db = yield* Database.Database

		const findActiveById = (id: ConnectInviteId) =>
			db.first(
				SQLite.from(schema.connectInvitesTable)
					.select()
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
					.limit(1),
			)

		const listIncomingForOrganization = (organizationId: OrganizationId) =>
			db.run(
				SQLite.from(schema.connectInvitesTable)
					.select()
					.where(($) => [$.guestOrganizationId.eq(organizationId), $.deletedAt.isNull()]),
			)

		const listOutgoingForOrganization = (organizationId: OrganizationId) =>
			db.run(
				SQLite.from(schema.connectInvitesTable)
					.select()
					.where(($) => [$.hostOrganizationId.eq(organizationId), $.deletedAt.isNull()]),
			)

		return {
			...baseRepo,
			findActiveById,
			listIncomingForOrganization,
			listOutgoingForOrganization,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
