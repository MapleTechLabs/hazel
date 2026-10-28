import { Database, SQLite, Repository, schema } from "@hazel/db"

import { ChatSyncMessageLink } from "@hazel/domain/models"
import type {
	ExternalMessageId,
	ExternalThreadId,
	MessageId,
	SyncChannelLinkId,
	SyncMessageLinkId,
} from "@hazel/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"

export class ChatSyncMessageLinkRepo extends Context.Service<ChatSyncMessageLinkRepo>()(
	"ChatSyncMessageLinkRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.chatSyncMessageLinksTable,
				{ insert: ChatSyncMessageLink.Insert, update: ChatSyncMessageLink.Update },
				{
					idColumn: "id",
					name: "ChatSyncMessageLink",
				},
			)
			const db = yield* Database.Database
			const decodeMessageLink = Schema.decodeUnknownSync(ChatSyncMessageLink.Schema)
			const decodeMessageLinkRows = (rows: readonly unknown[]) =>
				rows.map((row) => decodeMessageLink(row))
			const decodeMessageLinkOption = <T>(value: Option.Option<T>) =>
				Option.map(value, decodeMessageLink)

			const insert = (...args: Parameters<typeof baseRepo.insert>) =>
				baseRepo.insert(...args).pipe(Effect.map(decodeMessageLinkRows)) as ReturnType<
					typeof baseRepo.insert
				>

			const findByChannelLink = (channelLinkId: SyncChannelLinkId) =>
				db
					.run(
						SQLite.from(schema.chatSyncMessageLinksTable)
							.select()
							.where(($) => [$.channelLinkId.eq(channelLinkId), $.deletedAt.isNull()]),
					)
					.pipe(Effect.map(decodeMessageLinkRows))

			const findByHazelMessage = (channelLinkId: SyncChannelLinkId, hazelMessageId: MessageId) =>
				db
					.first(
						SQLite.from(schema.chatSyncMessageLinksTable)
							.select()
							.where(($) => [
								$.channelLinkId.eq(channelLinkId),
								$.hazelMessageId.eq(hazelMessageId),
								$.deletedAt.isNull(),
							])
							.limit(1),
					)
					.pipe(Effect.map(decodeMessageLinkOption))

			const findByExternalMessage = (
				channelLinkId: SyncChannelLinkId,
				externalMessageId: ExternalMessageId,
			) =>
				db
					.first(
						SQLite.from(schema.chatSyncMessageLinksTable)
							.select()
							.where(($) => [
								$.channelLinkId.eq(channelLinkId),
								$.externalMessageId.eq(externalMessageId),
								$.deletedAt.isNull(),
							])
							.limit(1),
					)
					.pipe(Effect.map(decodeMessageLinkOption))

			const findByRootHazelMessage = (
				channelLinkId: SyncChannelLinkId,
				rootHazelMessageId: MessageId,
			) =>
				db
					.first(
						SQLite.from(schema.chatSyncMessageLinksTable)
							.select()
							.where(($) => [
								$.channelLinkId.eq(channelLinkId),
								$.rootHazelMessageId.eq(rootHazelMessageId),
								$.deletedAt.isNull(),
							]),
					)
					.pipe(Effect.map(decodeMessageLinkOption))

			const updateLastSyncedAt = (id: SyncMessageLinkId) =>
				db.run(
					SQLite.update(schema.chatSyncMessageLinksTable)
						.set({
							lastSyncedAt: new Date(),
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			const softDelete = (id: SyncMessageLinkId) =>
				db.run(
					SQLite.update(schema.chatSyncMessageLinksTable)
						.set({
							deletedAt: new Date(),
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			return {
				...baseRepo,
				insert,
				findByChannelLink,
				findByHazelMessage,
				findByExternalMessage,
				findByRootHazelMessage,
				updateLastSyncedAt,
				softDelete,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
