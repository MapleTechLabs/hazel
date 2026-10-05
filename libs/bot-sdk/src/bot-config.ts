/**
 * Bot Environment Configuration
 *
 * Type-safe configuration from environment variables using Effect's Config module.
 * Provides automatic validation and helpful error messages.
 */

import { Config, type Effect } from "effect"

const DEFAULT_ACTORS_URL = "https://rivet.hazel.sh"

/**
 * Bot environment configuration schema
 *
 * Reads and validates the following environment variables:
 * - BOT_TOKEN (required) - Bot authentication token
 * - BACKEND_URL (optional) - Backend API URL for command sync and bot settings
 * - GATEWAY_URL (optional) - Gateway URL for inbound bot websocket delivery
 */
export const BotEnvConfig = Config.all({
	botToken: Config.Redacted("BOT_TOKEN"),
	backendUrl: Config.String("BACKEND_URL").pipe(Config.withDefault("https://api.hazel.sh")),
	gatewayUrl: Config.String("GATEWAY_URL").pipe(Config.withDefault("https://bot-gateway.hazel.sh")),
	actorsUrl: Config.String("ACTORS_URL").pipe(
		Config.orElse(() => Config.String("RIVET_URL")),
		Config.withDefault(DEFAULT_ACTORS_URL),
	),
	healthPort: Config.Number("PORT").pipe(Config.withDefault(0)),
})

export type BotEnvConfig = Effect.Success<typeof BotEnvConfig>
