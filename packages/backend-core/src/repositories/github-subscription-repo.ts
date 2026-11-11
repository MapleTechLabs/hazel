import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, GitHubSubscriptionId, OrganizationId } from "@hazel/schema"
import { GitHubSubscription } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class GitHubSubscriptionRepo extends Context.Service<GitHubSubscriptionRepo>()(
	"GitHubSubscriptionRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.githubSubscriptionsTable,
				{ insert: GitHubSubscription.Insert, update: GitHubSubscription.Update },
				{
					idColumn: "id",
					name: "GitHubSubscription",
				},
			)
			const db = yield* Database.Database

			// Find all subscriptions for a channel
			const findByChannel = (channelId: ChannelId) =>
				db.run(
					SQLite.from(schema.githubSubscriptionsTable)
						.select()
						.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()]),
				)

			// Find all subscriptions for an organization
			const findByOrganization = (organizationId: OrganizationId) =>
				db.run(
					SQLite.from(schema.githubSubscriptionsTable)
						.select()
						.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
				)

			// Find subscription by channel and repository (for uniqueness check)
			const findByChannelAndRepo = (channelId: ChannelId, repositoryId: number) =>
				db.first(
					SQLite.from(schema.githubSubscriptionsTable)
						.select()
						.where(($) => [
							$.channelId.eq(channelId),
							$.repositoryId.eq(repositoryId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			// Update subscription settings
			const updateSettings = (
				id: GitHubSubscriptionId,
				settings: {
					enabledEvents?: GitHubSubscription.GitHubEventType[]
					branchFilter?: string | null
					isEnabled?: boolean
				},
			) =>
				db.run(
					SQLite.update(schema.githubSubscriptionsTable)
						.set({
							...(settings.enabledEvents !== undefined && {
								enabledEvents: settings.enabledEvents,
							}),
							...(settings.branchFilter !== undefined && {
								branchFilter: settings.branchFilter,
							}),
							...(settings.isEnabled !== undefined && { isEnabled: settings.isEnabled }),
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			// Soft delete subscription
			const softDelete = (id: GitHubSubscriptionId) =>
				db.run(
					SQLite.update(schema.githubSubscriptionsTable)
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
				findByChannelAndRepo,
				updateSettings,
				softDelete,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
