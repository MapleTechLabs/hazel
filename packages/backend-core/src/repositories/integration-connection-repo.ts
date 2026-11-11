import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { IntegrationConnectionId, OrganizationId, UserId } from "@hazel/schema"
import { IntegrationConnection } from "@hazel/domain/models"
import { Context, DateTime, Effect, Layer, Option } from "effect"

/** Domain timestamps may be a `DateTime.Utc`; the timestamp columns take a `Date`. */
const toDate = <A extends Date | DateTime.Utc | null | undefined>(value: A) =>
	(DateTime.isDateTime(value) ? DateTime.toDate(value) : value) as Exclude<A, DateTime.Utc> | Date

export class IntegrationConnectionRepo extends Context.Service<IntegrationConnectionRepo>()(
	"IntegrationConnectionRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.integrationConnectionsTable,
				{ insert: IntegrationConnection.Insert, update: IntegrationConnection.Update },
				{
					idColumn: "id",
					name: "IntegrationConnection",
				},
			)
			const db = yield* Database.Database

			// Find org-level connection for a specific provider
			const findOrgConnection = (
				organizationId: OrganizationId,
				provider: IntegrationConnection.IntegrationProvider,
			) =>
				db.first(
					SQLite.from(schema.integrationConnectionsTable)
						.select()
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.provider.eq(provider),
							$.userId.isNull(),
							$.level.eq("organization"),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			// Find user-level connection for a specific provider
			const findUserConnection = (
				organizationId: OrganizationId,
				userId: UserId,
				provider: IntegrationConnection.IntegrationProvider,
			) =>
				db.first(
					SQLite.from(schema.integrationConnectionsTable)
						.select()
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.userId.eq(userId),
							$.provider.eq(provider),
							$.level.eq("user"),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			// Find user-level connection for a specific provider, including soft-deleted rows.
			// Used by upsert to reactivate previously disconnected links.
			const findUserConnectionIncludingDeleted = (
				organizationId: OrganizationId,
				userId: UserId,
				provider: IntegrationConnection.IntegrationProvider,
			) =>
				db.first(
					SQLite.from(schema.integrationConnectionsTable)
						.select()
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.userId.eq(userId),
							$.provider.eq(provider),
							$.level.eq("user"),
						])
						.limit(1),
				)

			// Get all active org-level connections for an organization
			const findActiveOrgConnections = (organizationId: OrganizationId) =>
				db.run(
					SQLite.from(schema.integrationConnectionsTable)
						.select()
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.level.eq("organization"),
							$.status.eq("active"),
							$.userId.isNull(),
							$.deletedAt.isNull(),
						]),
				)

			// Soft delete connection
			const softDelete = (connectionId: IntegrationConnectionId) =>
				db.run(
					SQLite.update(schema.integrationConnectionsTable)
						.set({
							deletedAt: new Date(),
							status: "revoked",
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(connectionId)])
						.returning(),
				)

			// Overwrite an existing connection with the given insert data
			const overwrite = (id: IntegrationConnectionId, data: typeof IntegrationConnection.Insert.Type) =>
				db.run(
					SQLite.update(schema.integrationConnectionsTable)
						.set({
							...data,
							lastUsedAt: toDate(data.lastUsedAt),
							deletedAt: toDate(data.deletedAt),
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			// Upsert org-level connection for a provider
			const upsertByOrgAndProvider = (insertData: typeof IntegrationConnection.Insert.Type) =>
				Effect.gen(function* () {
					const existing = yield* findOrgConnection(insertData.organizationId, insertData.provider)

					if (Option.isSome(existing)) {
						// Update existing connection
						const results = yield* overwrite(existing.value.id, insertData)
						return results[0]!
					}

					// Insert new connection - returns array, take first element
					const inserted = yield* baseRepo.insert(insertData)
					return inserted[0]!
				})

			// Upsert user-level connection for a provider.
			const upsertByUserAndProvider = (insertData: typeof IntegrationConnection.Insert.Type) =>
				Effect.gen(function* () {
					if (!insertData.userId) {
						return yield* Effect.die(
							"IntegrationConnectionRepo.upsertByUserAndProvider requires userId",
						)
					}

					const existing = yield* findUserConnectionIncludingDeleted(
						insertData.organizationId,
						insertData.userId,
						insertData.provider,
					)

					if (Option.isSome(existing)) {
						const results = yield* overwrite(existing.value.id, insertData)
						return results[0]!
					}

					const inserted = yield* baseRepo.insert(insertData)
					return inserted[0]!
				})

			return {
				...baseRepo,
				findOrgConnection,
				findUserConnection,
				findActiveOrgConnections,
				softDelete,
				upsertByOrgAndProvider,
				upsertByUserAndProvider,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
