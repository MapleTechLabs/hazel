import { Database, SQLite, schema } from "@hazel/db"
import type { IntegrationConnection } from "@hazel/domain/models"
import type { OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { installBotHere } from "../../worker/objects/org/bot-installs"
import { Directory } from "../directory"

/**
 * Integration Bot Service. Runs in the `OrgObject`.
 *
 * Installs the seeded bot of an OAuth provider (`internal-bot-<provider>`, a directory user with
 * a `bots` row) in the org once the org connects that provider. Webhook providers' shared bot
 * users are `WebhookBotService.getOrCreateIntegrationBot`.
 */
export class IntegrationBotService extends Context.Service<IntegrationBotService>()("IntegrationBotService", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database
		const directory = yield* Directory

		/**
		 * Install the provider's seeded bot here (idempotent). `None` when the seed is missing.
		 * Call inside the handler's transaction.
		 */
		const addBotToOrg = Effect.fn("IntegrationBotService.addBotToOrg")(function* (
			provider: IntegrationConnection.IntegrationProvider,
			organizationId: OrganizationId,
		) {
			const externalId = `internal-bot-${provider}`
			const user = yield* directory.db.first(
				SQLite.from(schema.usersTable)
					.select("id")
					.where(($) => [$.externalId.eq(externalId)])
					.limit(1),
			)
			if (Option.isNone(user)) {
				yield* Effect.logWarning("Bot user not found - has seed script been run?", {
					provider,
					externalId,
				})
				return Option.none<UserId>()
			}
			const bot = yield* directory.db.first(
				SQLite.from(schema.botsTable)
					.select()
					.where(($) => [$.userId.eq(user.value.id), $.deletedAt.isNull()])
					.limit(1),
			)
			if (Option.isNone(bot)) {
				yield* Effect.logWarning("Bot record not found for user - has seed script been run?", {
					provider,
					userId: user.value.id,
				})
				return Option.none<UserId>()
			}
			const installed = yield* db.first(
				SQLite.from(schema.botInstallationsTable)
					.select("id")
					.where(($) => [$.botId.eq(bot.value.id), $.organizationId.eq(organizationId)])
					.limit(1),
			)
			if (Option.isNone(installed)) {
				const commands = yield* directory.db.run(
					SQLite.from(schema.botCommandsTable)
						.select()
						.where(($) => [$.botId.eq(bot.value.id)]),
				)
				yield* installBotHere({
					bot: bot.value,
					commands,
					organizationId,
					installedBy: user.value.id,
				})
			}
			yield* Effect.annotateCurrentSpan({
				"bot.provider": provider,
				"bot.installed_now": Option.isNone(installed),
			})
			return Option.some(user.value.id)
		})

		return { addBotToOrg }
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
