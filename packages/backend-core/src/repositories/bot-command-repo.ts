import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { BotId } from "@hazel/schema"
import { BotCommand } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class BotCommandRepo extends Context.Service<BotCommandRepo>()("BotCommandRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.botCommandsTable,
			{ insert: BotCommand.Insert, update: BotCommand.Update },
			{
				idColumn: "id",
				name: "BotCommand",
			},
		)
		const db = yield* Database.Database

		// Find all commands for a bot
		const findByBot = (botId: BotId) =>
			db.run(
				SQLite.from(schema.botCommandsTable)
					.select()
					.where(($) => [$.botId.eq(botId)]),
			)

		// Find enabled commands for a bot
		const findEnabledByBot = (botId: BotId) =>
			db.run(
				SQLite.from(schema.botCommandsTable)
					.select()
					.where(($) => [$.botId.eq(botId), $.isEnabled.eq(true)]),
			)

		// Find commands for multiple bots (for getAvailableCommands)
		const findByBots = (botIds: BotId[]) => {
			if (botIds.length === 0) {
				return Effect.succeed([])
			}
			return db.run(
				SQLite.from(schema.botCommandsTable)
					.select()
					.where(($) => [$.botId.in_(...botIds), $.isEnabled.eq(true)]),
			)
		}

		// Find a specific command by bot and name
		const findByBotAndName = (botId: BotId, name: string) =>
			db.first(
				SQLite.from(schema.botCommandsTable)
					.select()
					.where(($) => [$.botId.eq(botId), $.name.eq(name)])
					.limit(1),
			)

		// Upsert command (for bot sync)
		const upsert = (data: {
			botId: BotId
			name: string
			description: string
			arguments: BotCommand.BotCommandArgument[] | null
			usageExample: string | null
		}) => {
			// Convert null values to undefined for DB schema compatibility
			const args = (data.arguments ?? []).map((arg) => ({
				...arg,
				description: arg.description ?? undefined,
				placeholder: arg.placeholder ?? undefined,
			}))
			return db
				.run(
					SQLite.insertInto(schema.botCommandsTable)
						.values({
							botId: data.botId,
							name: data.name,
							description: data.description,
							arguments: args,
							usageExample: data.usageExample,
							isEnabled: true,
						})
						.onConflictDoUpdate({
							target: ["botId", "name"],
							set: {
								description: data.description,
								arguments: args,
								usageExample: data.usageExample,
								isEnabled: true,
								updatedAt: new Date(),
							},
						})
						.returning(),
				)
				.pipe(Effect.map((results) => results[0]))
		}

		// Delete commands not updated since the given timestamp (for bot sync cleanup)
		const deleteStaleCommands = (botId: BotId, syncStartTime: Date) =>
			db.run(
				SQLite.deleteFrom(schema.botCommandsTable).where(($) => [
					$.botId.eq(botId),
					$.updatedAt.lt(syncStartTime),
				]),
			)

		return {
			...baseRepo,
			findByBot,
			findEnabledByBot,
			findByBots,
			findByBotAndName,
			upsert,
			deleteStaleCommands,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
