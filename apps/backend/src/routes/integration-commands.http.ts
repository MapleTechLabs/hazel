import { HttpApiBuilder } from "effect/http-api"
import { BotCommandRepo, BotInstallationRepo, BotRepo } from "@hazel/backend-core"
import { InternalServerError } from "@hazel/domain"
import { AvailableCommandsResponse } from "@hazel/domain/http"
import { Effect, Option } from "effect"
import { HazelApi } from "../api"

export const HttpIntegrationCommandLive = HttpApiBuilder.group(HazelApi, "integration-commands", (handlers) =>
	handlers
		// Get all available commands for the current organization's installed bots
		.handle("getAvailableCommands", ({ params }) =>
			Effect.gen(function* () {
				const { orgId } = params

				const botInstallationRepo = yield* BotInstallationRepo
				const botCommandRepo = yield* BotCommandRepo
				const botRepo = yield* BotRepo

				// Get bot commands for installed bots
				const installedBotIds = yield* botInstallationRepo.getBotIdsForOrg(orgId)
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
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while fetching commands",
							detail: String(error),
						}),
					),
				),
			),
		),
)
