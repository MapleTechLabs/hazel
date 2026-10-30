import { Database, SQLite, Repository, schema } from "@hazel/db"

import { type ChannelId, type ChannelMemberId, TypingIndicatorId } from "@hazel/schema"
import { TypingIndicator } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class TypingIndicatorRepo extends Context.Service<TypingIndicatorRepo>()("TypingIndicatorRepo", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database
		const baseRepo = yield* Repository.makeRepository(
			schema.typingIndicatorsTable,
			{ insert: TypingIndicator.Insert, update: TypingIndicator.Update },
			{
				idColumn: "id",
				name: "TypingIndicator",
			},
		)

		// Upsert method to create or update typing indicator
		const upsertByChannelAndMember = (params: {
			channelId: ChannelId
			memberId: ChannelMemberId
			lastTyped: number
		}) =>
			db.run(
				SQLite.insertInto(schema.typingIndicatorsTable)
					.values({
						id: TypingIndicatorId.make(crypto.randomUUID()),
						channelId: params.channelId,
						memberId: params.memberId,
						lastTyped: params.lastTyped,
					})
					.onConflictDoUpdate({
						target: ["channelId", "memberId"],
						set: { lastTyped: params.lastTyped },
					})
					.returning(),
			)

		return {
			...baseRepo,
			upsertByChannelAndMember,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
