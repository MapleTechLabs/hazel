import { Database, SQLite, Repository, schema } from "@hazel/db"
import type { ChannelId } from "@hazel/schema"
import { ConnectConversation } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ConnectConversationRepo extends Context.Service<ConnectConversationRepo>()(
	"ConnectConversationRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.connectConversationsTable,
				{ insert: ConnectConversation.Insert, update: ConnectConversation.Update },
				{
					idColumn: "id",
					name: "ConnectConversation",
				},
			)
			const db = yield* Database.Database

			const findByHostChannel = (hostChannelId: ChannelId) =>
				db.first(
					SQLite.from(schema.connectConversationsTable)
						.select()
						.where(($) => [$.hostChannelId.eq(hostChannelId), $.deletedAt.isNull()])
						.limit(1),
				)

			return {
				...baseRepo,
				findByHostChannel,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
