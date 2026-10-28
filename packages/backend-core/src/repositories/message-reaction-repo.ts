import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { MessageId, UserId } from "@hazel/schema"
import { MessageReaction } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class MessageReactionRepo extends Context.Service<MessageReactionRepo>()("MessageReactionRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.messageReactionsTable,
			{ insert: MessageReaction.Insert, update: MessageReaction.Update },
			{
				idColumn: "id",
				name: "MessageReaction",
			},
		)

		const db = yield* Database.Database

		const findByMessageUserEmoji = (messageId: MessageId, userId: UserId, emoji: string) =>
			db.first(
				SQLite.from(schema.messageReactionsTable)
					.select()
					.where(($) => [$.messageId.eq(messageId), $.userId.eq(userId), $.emoji.eq(emoji)])
					.limit(1),
			)

		return {
			...baseRepo,
			findByMessageUserEmoji,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
