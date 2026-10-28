import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { BotId, UserId } from "@hazel/schema"
import { Bot } from "@hazel/domain/models"
import { Context, Effect, Layer, type Schema } from "effect"

export class BotRepo extends Context.Service<BotRepo>()("BotRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.botsTable,
			{ insert: Bot.Insert, update: Bot.Update },
			{
				idColumn: "id",
				name: "Bot",
			},
		)
		const db = yield* Database.Database

		// Find bot by ID
		const findById = (id: BotId) =>
			db.first(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
					.limit(1),
			)

		// Find bot by token hash
		const findByTokenHash = (tokenHash: string) =>
			db.first(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [$.apiTokenHash.eq(tokenHash), $.deletedAt.isNull()])
					.limit(1),
			)

		// Find bot by user ID
		const findByUserId = (userId: UserId) =>
			db.first(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [$.userId.eq(userId), $.deletedAt.isNull()])
					.limit(1),
			)

		// Find all bots created by a user
		const findByCreator = (createdBy: UserId) =>
			db.run(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [$.createdBy.eq(createdBy), $.deletedAt.isNull()]),
			)

		// Find all public bots (for marketplace)
		const findPublic = (search?: string) =>
			db.run(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [
						$.isPublic.eq(true),
						$.deletedAt.isNull(),
						search ? $.name.like(`%${search}%`).or($.description.like(`%${search}%`)) : undefined,
					])
					.orderBy(["installCount", "asc"]),
			)

		// Find bots by IDs (for installed bots lookup)
		const findByIds = (ids: BotId[]) => {
			if (ids.length === 0) {
				return Effect.succeed([])
			}
			return db.run(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [$.id.in_(...ids), $.deletedAt.isNull()]),
			)
		}

		// Insert a new bot
		const insert = (data: Schema.Schema.Type<typeof Bot.Insert>) =>
			db.run(
				SQLite.insertInto(schema.botsTable)
					.values({
						userId: data.userId,
						createdBy: data.createdBy,
						name: data.name,
						description: data.description,
						webhookUrl: data.webhookUrl,
						apiTokenHash: data.apiTokenHash,
						scopes: data.scopes ? [...data.scopes] : null,
						metadata: data.metadata,
						isPublic: data.isPublic,
						installCount: data.installCount,
						allowedIntegrations: data.allowedIntegrations ? [...data.allowedIntegrations] : null,
					})
					.returning(),
			)

		// Update a bot
		const update = (
			data: { id: BotId } & Partial<
				Omit<Schema.Schema.Type<typeof Bot.Update>, "id" | "createdAt" | "updatedAt" | "deletedAt">
			>,
		) =>
			db
				.run(
					SQLite.update(schema.botsTable)
						.set({
							...(data.name !== undefined && { name: data.name }),
							...(data.description !== undefined && {
								description: data.description,
							}),
							...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
							...(data.scopes !== undefined && {
								scopes: data.scopes ? [...data.scopes] : null,
							}),
							...(data.isPublic !== undefined && { isPublic: data.isPublic }),
							...(data.apiTokenHash !== undefined && {
								apiTokenHash: data.apiTokenHash,
							}),
							...(data.mentionable !== undefined && {
								mentionable: data.mentionable,
							}),
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(data.id), $.deletedAt.isNull()])
						.returning(),
				)
				.pipe(Effect.map((results) => results[0]))

		// Update token hash
		const updateTokenHash = (id: BotId, tokenHash: string) =>
			db
				.run(
					SQLite.update(schema.botsTable)
						.set({ apiTokenHash: tokenHash, updatedAt: new Date() })
						.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
						.returning(),
				)
				.pipe(Effect.map((results) => results[0]))

		// Soft delete a bot
		const softDelete = (id: BotId) =>
			db.run(
				SQLite.update(schema.botsTable)
					.set({ deletedAt: new Date() })
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()]),
			)

		// Increment install count
		const incrementInstallCount = (id: BotId) =>
			db.run(
				SQLite.update(schema.botsTable)
					.set(($) => ({ installCount: $.installCount.add(1) }))
					.where(($) => [$.id.eq(id)]),
			)

		// Decrement install count
		const decrementInstallCount = (id: BotId) =>
			db.run(
				SQLite.update(schema.botsTable)
					.set(($) => ({ installCount: SQLite.greatest(SQLite.lit(0), $.installCount.sub(1)) }))
					.where(($) => [$.id.eq(id)]),
			)

		return {
			...baseRepo,
			findById,
			findByTokenHash,
			findByUserId,
			findByCreator,
			findPublic,
			findByIds,
			insert,
			update,
			updateTokenHash,
			softDelete,
			incrementInstallCount,
			decrementInstallCount,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
