// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `BotCommands` over Hazel's HTTP API (`bot-commands.executeBotCommand`), for every host: each
 * provides it on its own `HazelApiClient` (`@hazel/client-data`).
 */
import { HazelApiClient } from "@hazel/client-data"
import { ExecuteBotCommandRequest } from "@hazel/domain/http"
import { Effect, Layer, Match } from "effect"
import { type BotCommandFailure, BotCommands } from "./host"

// BOUNDARY: the API's errors by tag, anything else as unavailable.
const failureOf = (error: unknown): BotCommandFailure =>
	Match.value(
		typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "",
	).pipe(
		Match.when("BotNotFoundError", (): BotCommandFailure => "BotNotFound"),
		Match.when("BotNotInstalledError", (): BotCommandFailure => "BotNotInstalled"),
		Match.when("BotCommandNotFoundError", (): BotCommandFailure => "CommandNotFound"),
		Match.when("BotCommandExecutionError", (): BotCommandFailure => "ExecutionFailed"),
		Match.orElse((): BotCommandFailure => "Unavailable"),
	)

export const botCommandsLayer = Layer.effect(
	BotCommands,
	Effect.map(Effect.service(HazelApiClient), (client) =>
		BotCommands.of({
			execute: ({ orgId, botId, commandName, channelId, arguments: args }) =>
				client["bot-commands"]
					.executeBotCommand({
						params: { orgId, botId, commandName },
						payload: new ExecuteBotCommandRequest({ channelId, arguments: [...args] }),
					})
					.pipe(Effect.asVoid, Effect.mapError(failureOf)),
		}),
	),
)
