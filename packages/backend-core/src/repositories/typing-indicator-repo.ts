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

		// Add custom method to delete by channel and member
		const deleteByChannelAndMember = ({
			channelId,
			memberId,
		}: {
			channelId: ChannelId
			memberId: ChannelMemberId
		}) =>
			db.run(
				SQLite.deleteFrom(schema.typingIndicatorsTable).where(($) => [
					$.channelId.eq(channelId),
					$.memberId.eq(memberId),
				]),
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

		// Cleanup method to remove stale indicators
		const deleteStale = (thresholdMs: number = 10000) => {
			const threshold = Date.now() - thresholdMs
			return db.run(
				SQLite.deleteFrom(schema.typingIndicatorsTable)
					.where(($) => [$.lastTyped.lt(threshold)])
					.returning(),
			)
		}

		return {
			...baseRepo,
			deleteByChannelAndMember,
			upsertByChannelAndMember,
			deleteStale,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
