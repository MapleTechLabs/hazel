import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { OrganizationId } from "@hazel/schema"
import { BotInstallation } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

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

		// Get bot IDs installed in an organization
		const getBotIdsForOrg = (organizationId: OrganizationId) =>
			findByOrg(organizationId).pipe(Effect.map((installations) => installations.map((i) => i.botId)))

		return {
			...baseRepo,
			getBotIdsForOrg,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
