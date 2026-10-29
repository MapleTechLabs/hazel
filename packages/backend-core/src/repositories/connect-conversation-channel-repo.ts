import { Database, SQLite, Repository, schema } from "@hazel/db"
import type { ChannelId, ConnectConversationId, OrganizationId } from "@hazel/schema"
import { ConnectConversationChannel } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ConnectConversationChannelRepo extends Context.Service<ConnectConversationChannelRepo>()(
	"ConnectConversationChannelRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.connectConversationChannelsTable,
				{ insert: ConnectConversationChannel.Insert, update: ConnectConversationChannel.Update },
				{
					idColumn: "id",
					name: "ConnectConversationChannel",
				},
			)
			const db = yield* Database.Database

			const findByChannelId = (channelId: ChannelId) =>
				db.first(
					SQLite.from(schema.connectConversationChannelsTable)
						.select()
						.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()])
						.limit(1),
				)

			const findByConversationId = (conversationId: ConnectConversationId) =>
				db.run(
					SQLite.from(schema.connectConversationChannelsTable)
						.select()
						.where(($) => [$.conversationId.eq(conversationId), $.deletedAt.isNull()]),
				)

			const findByConversationAndOrganization = (
				conversationId: ConnectConversationId,
				organizationId: OrganizationId,
			) =>
				db.first(
					SQLite.from(schema.connectConversationChannelsTable)
						.select()
						.where(($) => [
							$.conversationId.eq(conversationId),
							$.organizationId.eq(organizationId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)

			return {
				...baseRepo,
				findByChannelId,
				findByConversationId,
				findByConversationAndOrganization,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
