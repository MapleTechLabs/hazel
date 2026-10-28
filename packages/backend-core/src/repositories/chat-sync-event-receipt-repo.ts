import { Database, SQLite, Repository, schema } from "@hazel/db"

import { ChatSyncEventReceipt } from "@hazel/domain/models"
import type { SyncChannelLinkId, SyncConnectionId, SyncEventReceiptId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"

export class ChatSyncEventReceiptRepo extends Context.Service<ChatSyncEventReceiptRepo>()(
	"ChatSyncEventReceiptRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.chatSyncEventReceiptsTable,
				{ insert: ChatSyncEventReceipt.Insert, update: ChatSyncEventReceipt.Update },
				{
					idColumn: "id",
					name: "ChatSyncEventReceipt",
				},
			)
			const db = yield* Database.Database

			const findByDedupeKey = (
				syncConnectionId: SyncConnectionId,
				source: ChatSyncEventReceipt.ChatSyncReceiptSource,
				dedupeKey: string,
			) =>
				db.first(
					SQLite.from(schema.chatSyncEventReceiptsTable)
						.select()
						.where(($) => [
							$.syncConnectionId.eq(syncConnectionId),
							$.source.eq(source),
							$.dedupeKey.eq(dedupeKey),
						])
						.limit(1),
				)

			const claimByDedupeKey = (params: {
				syncConnectionId: SyncConnectionId
				channelLinkId?: SyncChannelLinkId | null
				source: ChatSyncEventReceipt.ChatSyncReceiptSource
				dedupeKey: string
			}) =>
				db
					.run(
						SQLite.insertInto(schema.chatSyncEventReceiptsTable)
							.values({
								syncConnectionId: params.syncConnectionId,
								channelLinkId: params.channelLinkId ?? null,
								source: params.source,
								externalEventId: null,
								dedupeKey: params.dedupeKey,
								payloadHash: null,
								status: "processed",
								errorMessage: null,
							})
							.onConflictDoNothing({ target: ["syncConnectionId", "source", "dedupeKey"] })
							.returning("id"),
					)
					.pipe(Effect.map((results) => results.length > 0))

			const updateByDedupeKey = (params: {
				syncConnectionId: SyncConnectionId
				source: ChatSyncEventReceipt.ChatSyncReceiptSource
				dedupeKey: string
				channelLinkId?: SyncChannelLinkId | null
				externalEventId?: string | null
				payloadHash?: string | null
				status?: ChatSyncEventReceipt.ChatSyncReceiptStatus
				errorMessage?: string | null
			}) => {
				const set: {
					channelLinkId?: SyncChannelLinkId | null
					externalEventId?: string | null
					payloadHash: string | null
					status: ChatSyncEventReceipt.ChatSyncReceiptStatus
					errorMessage: string | null
					processedAt: Date
				} = {
					payloadHash: params.payloadHash ?? null,
					status: params.status ?? "processed",
					errorMessage: params.errorMessage ?? null,
					processedAt: new Date(),
				}
				if (params.channelLinkId !== undefined) {
					set.channelLinkId = params.channelLinkId
				}
				if (params.externalEventId !== undefined) {
					set.externalEventId = params.externalEventId
				}

				return db.run(
					SQLite.update(schema.chatSyncEventReceiptsTable)
						.set(set)
						.where(($) => [
							$.syncConnectionId.eq(params.syncConnectionId),
							$.source.eq(params.source),
							$.dedupeKey.eq(params.dedupeKey),
						])
						.returning(),
				)
			}

			/** Drops a claim so the same delivery can be claimed again (after a retryable failure). */
			const releaseByDedupeKey = (params: {
				syncConnectionId: SyncConnectionId
				source: ChatSyncEventReceipt.ChatSyncReceiptSource
				dedupeKey: string
			}) =>
				db.run(
					SQLite.deleteFrom(schema.chatSyncEventReceiptsTable).where(($) => [
						$.syncConnectionId.eq(params.syncConnectionId),
						$.source.eq(params.source),
						$.dedupeKey.eq(params.dedupeKey),
					]),
				)

			const findRecentByConnection = (syncConnectionId: SyncConnectionId, processedAfter: Date) =>
				db.run(
					SQLite.from(schema.chatSyncEventReceiptsTable)
						.select()
						.where(($) => [
							$.syncConnectionId.eq(syncConnectionId),
							$.processedAt.gte(processedAfter),
						]),
				)

			const markFailed = (id: SyncEventReceiptId, errorMessage: string) =>
				db.run(
					SQLite.update(schema.chatSyncEventReceiptsTable)
						.set({
							status: "failed",
							errorMessage,
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			return {
				...baseRepo,
				findByDedupeKey,
				claimByDedupeKey,
				updateByDedupeKey,
				releaseByDedupeKey,
				findRecentByConnection,
				markFailed,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
