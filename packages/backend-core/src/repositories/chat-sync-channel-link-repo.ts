import { Database, SQLite, Repository, schema } from "@hazel/db"

import { ChatSyncChannelLink } from "@hazel/domain/models"
import type { ChannelId, ExternalChannelId, SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"

export class ChatSyncChannelLinkRepo extends Context.Service<ChatSyncChannelLinkRepo>()(
	"ChatSyncChannelLinkRepo",
	{
		make: Effect.gen(function* () {
			const baseRepo = yield* Repository.makeRepository(
				schema.chatSyncChannelLinksTable,
				{ insert: ChatSyncChannelLink.Insert, update: ChatSyncChannelLink.Update },
				{
					idColumn: "id",
					name: "ChatSyncChannelLink",
				},
			)
			const db = yield* Database.Database
			const decodeChannelLink = Schema.decodeUnknownSync(ChatSyncChannelLink.Schema)
			const decodeChannelLinkRows = (rows: readonly unknown[]) =>
				rows.map((row) => decodeChannelLink(row))
			const decodeChannelLinkOption = <T>(value: Option.Option<T>) =>
				Option.map(value, decodeChannelLink)

			const insert = (...args: Parameters<typeof baseRepo.insert>) =>
				baseRepo.insert(...args).pipe(Effect.map(decodeChannelLinkRows)) as ReturnType<
					typeof baseRepo.insert
				>

			const findById = (id: SyncChannelLinkId) =>
				db
					.first(
						SQLite.from(schema.chatSyncChannelLinksTable)
							.select()
							.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
							.limit(1),
					)
					.pipe(Effect.map(decodeChannelLinkOption))

			const findBySyncConnection = (syncConnectionId: SyncConnectionId) =>
				db
					.run(
						SQLite.from(schema.chatSyncChannelLinksTable)
							.select()
							.where(($) => [$.syncConnectionId.eq(syncConnectionId), $.deletedAt.isNull()]),
					)
					.pipe(Effect.map(decodeChannelLinkRows))

			const findByHazelChannel = (syncConnectionId: SyncConnectionId, hazelChannelId: ChannelId) =>
				db
					.first(
						SQLite.from(schema.chatSyncChannelLinksTable)
							.select()
							.where(($) => [
								$.syncConnectionId.eq(syncConnectionId),
								$.hazelChannelId.eq(hazelChannelId),
								$.deletedAt.isNull(),
							])
							.limit(1),
					)
					.pipe(Effect.map(decodeChannelLinkOption))

			const findByExternalChannel = (
				syncConnectionId: SyncConnectionId,
				externalChannelId: ExternalChannelId,
			) =>
				db
					.first(
						SQLite.from(schema.chatSyncChannelLinksTable)
							.select()
							.where(($) => [
								$.syncConnectionId.eq(syncConnectionId),
								$.externalChannelId.eq(externalChannelId),
								$.deletedAt.isNull(),
							])
							.limit(1),
					)
					.pipe(Effect.map(decodeChannelLinkOption))

			const setActive = (id: SyncChannelLinkId, isActive: boolean) =>
				db.run(
					SQLite.update(schema.chatSyncChannelLinksTable)
						.set({
							isActive,
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			const updateDirection = (
				id: SyncChannelLinkId,
				direction: ChatSyncChannelLink.ChatSyncDirection,
			) =>
				db.run(
					SQLite.update(schema.chatSyncChannelLinksTable)
						.set({
							direction,
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			const softDelete = (id: SyncChannelLinkId) =>
				db.run(
					SQLite.update(schema.chatSyncChannelLinksTable)
						.set({
							deletedAt: new Date(),
							isActive: false,
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			const updateSettings = (id: SyncChannelLinkId, settings: Record<string, unknown> | null) =>
				db.run(
					SQLite.update(schema.chatSyncChannelLinksTable)
						.set({
							settings,
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(id)])
						.returning(),
				)

			return {
				...baseRepo,
				insert,
				findBySyncConnection,
				findById,
				findByHazelChannel,
				findByExternalChannel,
				setActive,
				updateDirection,
				updateSettings,
				softDelete,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
