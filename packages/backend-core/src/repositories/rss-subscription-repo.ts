import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, OrganizationId, RssSubscriptionId } from "@hazel/schema"
import { RssSubscription } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class RssSubscriptionRepo extends Context.Service<RssSubscriptionRepo>()("RssSubscriptionRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.rssSubscriptionsTable,
			{ insert: RssSubscription.Insert, update: RssSubscription.Update },
			{
				idColumn: "id",
				name: "RssSubscription",
			},
		)
		const db = yield* Database.Database

		// Find all subscriptions for a channel
		const findByChannel = (channelId: ChannelId) =>
			db.run(
				SQLite.from(schema.rssSubscriptionsTable)
					.select()
					.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()]),
			)

		// Find all subscriptions for an organization
		const findByOrganization = (organizationId: OrganizationId) =>
			db.run(
				SQLite.from(schema.rssSubscriptionsTable)
					.select()
					.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
			)

		// Find subscription by channel and feed URL (for uniqueness check)
		const findByChannelAndFeedUrl = (channelId: ChannelId, feedUrl: string) =>
			db.first(
				SQLite.from(schema.rssSubscriptionsTable)
					.select()
					.where(($) => [$.channelId.eq(channelId), $.feedUrl.eq(feedUrl), $.deletedAt.isNull()])
					.limit(1),
			)

		// Update subscription settings
		const updateSettings = (
			id: RssSubscriptionId,
			settings: {
				isEnabled?: boolean
				pollingIntervalMinutes?: number
			},
		) =>
			db.run(
				SQLite.update(schema.rssSubscriptionsTable)
					.set({
						...(settings.isEnabled !== undefined && { isEnabled: settings.isEnabled }),
						...(settings.pollingIntervalMinutes !== undefined && {
							pollingIntervalMinutes: settings.pollingIntervalMinutes,
						}),
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		// Soft delete subscription
		const softDelete = (id: RssSubscriptionId) =>
			db.run(
				SQLite.update(schema.rssSubscriptionsTable)
					.set({
						deletedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(($) => [$.id.eq(id)])
					.returning(),
			)

		return {
			...baseRepo,
			findByChannel,
			findByOrganization,
			findByChannelAndFeedUrl,
			updateSettings,
			softDelete,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
