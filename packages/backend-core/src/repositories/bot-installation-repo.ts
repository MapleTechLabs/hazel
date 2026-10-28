import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { BotId, OrganizationId } from "@hazel/schema"
import { BotInstallation } from "@hazel/domain/models"
import { Context, Effect, Layer, Option } from "effect"

export class BotInstallationRepo extends Context.Service<BotInstallationRepo>()("BotInstallationRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.botInstallationsTable,
			{ insert: BotInstallation.Insert, update: BotInstallation.Update },
			{
				idColumn: "id",
				name: "BotInstallation",
			},
		)
		const db = yield* Database.Database

		// Find all installations for an organization
		const findByOrg = (organizationId: OrganizationId) =>
			db.run(
				SQLite.from(schema.botInstallationsTable)
					.select()
					.where(($) => [$.organizationId.eq(organizationId)]),
			)

		// Find all installations for a bot
		const findByBot = (botId: BotId) =>
			db.run(
				SQLite.from(schema.botInstallationsTable)
					.select()
					.where(($) => [$.botId.eq(botId)]),
			)

		// Find a specific installation
		const findByBotAndOrg = (botId: BotId, organizationId: OrganizationId) =>
			db.first(
				SQLite.from(schema.botInstallationsTable)
					.select()
					.where(($) => [$.botId.eq(botId), $.organizationId.eq(organizationId)])
					.limit(1),
			)

		// Check if a bot is installed in an organization
		const isInstalled = (botId: BotId, organizationId: OrganizationId) =>
			findByBotAndOrg(botId, organizationId).pipe(Effect.map(Option.isSome))

		// Get bot IDs installed in an organization
		const getBotIdsForOrg = (organizationId: OrganizationId) =>
			findByOrg(organizationId).pipe(Effect.map((installations) => installations.map((i) => i.botId)))

		return {
			...baseRepo,
			findByOrg,
			findByBot,
			findByBotAndOrg,
			isInstalled,
			getBotIdsForOrg,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
