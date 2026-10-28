import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { CustomEmojiId, OrganizationId } from "@hazel/schema"
import { CustomEmoji } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class CustomEmojiRepo extends Context.Service<CustomEmojiRepo>()("CustomEmojiRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.customEmojisTable,
			{ insert: CustomEmoji.Insert, update: CustomEmoji.Update },
			{
				idColumn: "id",
				name: "CustomEmoji",
			},
		)
		const db = yield* Database.Database

		const findByOrgAndName = (organizationId: OrganizationId, name: string) =>
			db.first(
				SQLite.from(schema.customEmojisTable)
					.select()
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.name.eq(name),
						$.deletedAt.isNull(),
					])
					.limit(1),
			)

		const findDeletedByOrgAndName = (organizationId: OrganizationId, name: string) =>
			db.first(
				SQLite.from(schema.customEmojisTable)
					.select()
					.where(($) => [
						$.organizationId.eq(organizationId),
						$.name.eq(name),
						$.deletedAt.isNotNull(),
					])
					.limit(1),
			)

		const restore = (id: CustomEmojiId, imageUrl?: string) =>
			db.first(
				SQLite.update(schema.customEmojisTable)
					.set({
						deletedAt: null,
						updatedAt: new Date(),
						...(imageUrl !== undefined ? { imageUrl } : {}),
					})
					.where(($) => [$.id.eq(id), $.deletedAt.isNotNull()])
					.returning(),
			)

		const softDelete = (id: CustomEmojiId) =>
			db.first(
				SQLite.update(schema.customEmojisTable)
					.set({ deletedAt: new Date() })
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
					.returning(),
			)

		return {
			...baseRepo,
			findByOrgAndName,
			findDeletedByOrgAndName,
			softDelete,
			restore,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
