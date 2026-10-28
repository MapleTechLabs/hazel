import { Database, SQLite, Repository, schema } from "@hazel/db"

import { ChatSyncConnection } from "@hazel/domain/models"
import type { IntegrationConnectionId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"

export class ChatSyncConnectionRepo extends Context.Service<ChatSyncConnectionRepo>()(
	"ChatSyncConnectionRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.chatSyncConnectionsTable,
				{ insert: ChatSyncConnection.Insert, update: ChatSyncConnection.Update },
				{
					idColumn: "id",
					name: "ChatSyncConnection",
				},
			)
			const db = yield* Database.Database

			const findByOrganization = (organizationId: OrganizationId) =>
				db.run(
					SQLite.from(schema.chatSyncConnectionsTable)
						.select()
						.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
				)

			const findByProviderAndWorkspace = (
				organizationId: OrganizationId,
				provider: string,
				externalWorkspaceId: string,
			) =>
				db.first(
					SQLite.from(schema.chatSyncConnectionsTable)
						.select()
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.provider.eq(provider),
							$.externalWorkspaceId.eq(externalWorkspaceId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			const findActiveByProvider = (provider: string) =>
				db.run(
					SQLite.from(schema.chatSyncConnectionsTable)
						.select()
						.where(($) => [$.provider.eq(provider), $.status.eq("active"), $.deletedAt.isNull()]),
				)

			const findByIntegrationConnectionId = (integrationConnectionId: IntegrationConnectionId) =>
				db.first(
					SQLite.from(schema.chatSyncConnectionsTable)
						.select()
						.where(($) => [
							$.integrationConnectionId.eq(integrationConnectionId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			const updateStatus = (
				id: SyncConnectionId,
				status: ChatSyncConnection.ChatSyncConnectionStatus,
				errorMessage?: string,
			) =>
				db.run(
					SQLite.update(schema.chatSyncConnectionsTable)
						.set({
							status,
							errorMessage: errorMessage ?? null,
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			const updateLastSyncedAt = (id: SyncConnectionId) =>
				db.run(
					SQLite.update(schema.chatSyncConnectionsTable)
						.set({
							lastSyncedAt: new Date(),
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			const softDelete = (id: SyncConnectionId) =>
				db.run(
					SQLite.update(schema.chatSyncConnectionsTable)
						.set({
							deletedAt: new Date(),
							status: "disabled",
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			return {
				...baseRepo,
				findByOrganization,
				findByProviderAndWorkspace,
				findActiveByProvider,
				findByIntegrationConnectionId,
				updateStatus,
				updateLastSyncedAt,
				softDelete,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
