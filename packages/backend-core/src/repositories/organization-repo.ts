import { Database, SQLite, Repository, schema } from "@hazel/db"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Organization } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"
import { ChannelMemberRepo } from "./channel-member-repo"
import { ChannelRepo } from "./channel-repo"

export class OrganizationRepo extends Context.Service<OrganizationRepo>()("OrganizationRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.organizationsTable,
			{ insert: Organization.Insert, update: Organization.Update },
			{
				idColumn: "id",
				name: "Organization",
			},
		)
		const db = yield* Database.Database
		const channelRepo = yield* ChannelRepo
		const channelMemberRepo = yield* ChannelMemberRepo

		const softDelete = (id: OrganizationId) =>
			db.run(
				SQLite.update(schema.organizationsTable)
					.set({ deletedAt: new Date() })
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()]),
			)

		const setupDefaultChannels = (organizationId: OrganizationId, userId: UserId) =>
			Effect.gen(function* () {
				// Create default "general" channel
				const defaultChannel = yield* channelRepo
					.insert({
						name: "general",
						icon: null,
						type: "public",
						organizationId,
						parentChannelId: null,
						sectionId: null,
						deletedAt: null,
					})
					.pipe(Effect.map((res) => res[0]!))

				// Add creator as channel member
				yield* channelMemberRepo.insert({
					channelId: defaultChannel.id,
					userId,
					isHidden: false,
					isMuted: false,
					isFavorite: false,
					lastSeenMessageId: null,
					notificationCount: 0,
					joinedAt: new Date(),
					deletedAt: null,
				})

				return defaultChannel
			})

		return {
			...baseRepo,
			softDelete,
			setupDefaultChannels,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelRepo.layer),
		Layer.provide(ChannelMemberRepo.layer),
	)
}
