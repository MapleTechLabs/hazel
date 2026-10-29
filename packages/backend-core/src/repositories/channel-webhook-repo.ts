import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, ChannelWebhookId, OrganizationId } from "@hazel/schema"
import { ChannelWebhook } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ChannelWebhookRepo extends Context.Service<ChannelWebhookRepo>()("ChannelWebhookRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.channelWebhooksTable,
			{ insert: ChannelWebhook.Insert, update: ChannelWebhook.Update },
			{
				idColumn: "id",
				name: "ChannelWebhook",
			},
		)
		const db = yield* Database.Database

		// Find all webhooks for a channel
		const findByChannel = (channelId: ChannelId) =>
			db.run(
				SQLite.from(schema.channelWebhooksTable)
					.select()
					.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()]),
			)

		// Find webhook by token hash (for authentication)
		const findByTokenHash = (tokenHash: string) =>
			db.first(
				SQLite.from(schema.channelWebhooksTable)
					.select()
					.where(($) => [$.tokenHash.eq(tokenHash), $.deletedAt.isNull()])
					.limit(1),
			)

		// Update last used timestamp
		const updateLastUsed = (id: ChannelWebhookId) =>
			db.run(
				SQLite.update(schema.channelWebhooksTable)
					.set({ lastUsedAt: new Date(), updatedAt: new Date() })
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		// Update token hash (for token regeneration)
		const updateToken = (id: ChannelWebhookId, tokenHash: string, tokenSuffix: string) =>
			db.run(
				SQLite.update(schema.channelWebhooksTable)
					.set({
						tokenHash,
						tokenSuffix,
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		// Soft delete webhook
		const softDelete = (id: ChannelWebhookId) =>
			db.run(
				SQLite.update(schema.channelWebhooksTable)
					.set({
						deletedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		// Find all webhooks for an organization
		const findByOrganization = (organizationId: OrganizationId) =>
			db.run(
				SQLite.from(schema.channelWebhooksTable)
					.select()
					.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
			)

		return {
			...baseRepo,
			findByChannel,
			findByTokenHash,
			updateLastUsed,
			updateToken,
			softDelete,
			findByOrganization,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
