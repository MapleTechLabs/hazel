import { HttpApiBuilder } from "effect/http-api"
import { BotCommandRepo, BotRepo } from "@hazel/backend-core"
import { SQLite, schema } from "@hazel/db"
import { InternalServerError } from "@hazel/domain"
import { AvailableCommandsResponse } from "@hazel/domain/http"
import { Effect, Option } from "effect"
import { HazelApi } from "../api"
import { Directory } from "../services/directory"

/**
 * Slash commands of the bots installed in an org, from the directory: a bot is installed where
 * its user has an active `membership_index` row (the `OrgObject` keeps it current).
 */
export const HttpIntegrationCommandLive = HttpApiBuilder.group(HazelApi, "integration-commands", (handlers) =>
	handlers
		// Get all available commands for the current organization's installed bots
		.handle("getAvailableCommands", ({ params }) =>
			Effect.gen(function* () {
				const { orgId } = params

				const directory = yield* Directory
				const botCommandRepo = yield* BotCommandRepo
				const botRepo = yield* BotRepo

				// Get bot commands for installed bots
				const installed = yield* directory.db.run(
					SQLite.from(schema.botsTable)
						.innerJoin(schema.membershipIndexTable, "m", (bot, m) => m.userId.eq(bot.userId))
						.select(($) => ({ id: $.id }))
						.where(($) => [
							$.m.organizationId.eq(orgId),
							$.m.deletedAt.isNull(),
							$.deletedAt.isNull(),
						]),
				)
				const installedBotIds = installed.map((row) => row.id)
				const botCommands = yield* botCommandRepo.findByBots(installedBotIds)

				// Get bot info for each command
				const commands = yield* Effect.all(
					botCommands.map((cmd) =>
						Effect.gen(function* () {
							const botOption = yield* botRepo.findById(cmd.botId)
							if (Option.isNone(botOption)) return null
							const bot = botOption.value
							return {
								id: cmd.id,
								name: cmd.name,
								description: cmd.description,
								provider: "bot" as const,
								arguments: (cmd.arguments ?? []).map((arg) => ({
									name: arg.name,
									description: arg.description ?? null,
									required: arg.required,
									placeholder: arg.placeholder ?? null,
									type: arg.type,
								})),
								usageExample: cmd.usageExample ?? null,
								bot: {
									id: bot.id,
									name: bot.name,
									avatarUrl: null, // TODO: Add avatar URL to bot
								},
							}
						}),
					),
					{ concurrency: "unbounded" },
				).pipe(Effect.map((results) => results.filter((r) => r !== null)))

				return new AvailableCommandsResponse({ commands })
			}).pipe(
				Effect.withSpan("IntegrationCommands.getAvailableCommands"),
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while fetching commands",
							cause: error,
						}),
					),
				),
			),
		),
)
