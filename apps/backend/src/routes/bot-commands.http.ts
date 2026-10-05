import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { BotCommandRepo, BotInstallationRepo, BotRepo, IntegrationConnectionRepo } from "@hazel/backend-core"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import {
	BotCommandExecutionAccepted,
	BotCommandExecutionError,
	BotCommandNotFoundError,
	BotMeResponse,
	BotNotFoundError,
	BotNotInstalledError,
	EnabledIntegrationsResponse,
	IntegrationNotAllowedError,
	IntegrationNotConnectedError,
	IntegrationTokenResponse,
	SyncBotCommandsResponse,
	UpdateBotSettingsResponse,
} from "@hazel/domain/http"
import { Redis } from "@hazel/effect-bun"
import { Cause, Effect, Option, Stream } from "effect"
import { HazelApi } from "../api.ts"
import { BotGatewayService } from "../services/bot-gateway-service.ts"
import { IntegrationTokenService } from "../services/integration-token-service.ts"
import { createCommandSseStream } from "./bot-commands.sse.ts"

/**
 * Hash a token using SHA-256 (Web Crypto API)
 */
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Validate bot token from Authorization header and return the bot
 */
const validateBotToken = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const authHeader = request.headers.authorization

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "Missing or invalid bot token",
				detail: "Authorization header must be 'Bearer <token>'",
			}),
		)
	}

	const token = authHeader.slice(7)
	const tokenHash = yield* Effect.promise(() => hashToken(token))

	const botRepo = yield* BotRepo
	const botOption = yield* botRepo.findByTokenHash(tokenHash)

	if (Option.isNone(botOption)) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "Invalid bot token",
				detail: "No bot found with this token",
			}),
		)
	}

	return botOption.value
})

export const HttpBotCommandsLive = HttpApiBuilder.group(HazelApi, "bot-commands", (handlers) =>
	handlers
		// SSE stream for bot commands (bot token auth)
		.handle("streamCommands", () =>
			Effect.gen(function* () {
				// Validate bot token
				const bot = yield* validateBotToken

				const redis = yield* Redis
				const channel = `bot:${bot.id}:commands`

				yield* Effect.logInfo(`Bot ${bot.id} (${bot.name}) connecting to SSE stream`)

				// Merge command events with keepalive heartbeat events so idle connections stay active.
				const sseStream = createCommandSseStream({
					botId: bot.id,
					botName: bot.name,
					channel,
					redis,
				}).pipe(
					Stream.tap(() => Effect.logDebug("Sending SSE event")),
					Stream.encodeText,
				)

				// Return SSE response
				return HttpServerResponse.stream(sseStream, {
					contentType: "text/event-stream",
					headers: {
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						"X-Accel-Buffering": "no",
					},
				})
			}).pipe(
				Effect.catchTag("DatabaseError", () =>
					Effect.fail(
						new UnauthorizedError({
							message: "Failed to validate bot token",
							detail: "Database error",
						}),
					),
				),
			),
		)
		// Get bot info from token (for SDK authentication)
		.handle("getBotMe", () =>
			Effect.gen(function* () {
				const bot = yield* validateBotToken
				return new BotMeResponse({
					botId: bot.id,
					userId: bot.userId,
					name: bot.name,
				})
			}).pipe(
				Effect.catchTag("DatabaseError", () =>
					Effect.fail(
						new UnauthorizedError({
							message: "Failed to validate bot token",
							detail: "Database error",
						}),
					),
				),
			),
		)
		// Sync commands from bot SDK (bot token auth)
		.handle("syncCommands", ({ payload }) =>
			Effect.gen(function* () {
				const bot = yield* validateBotToken
				const commandRepo = yield* BotCommandRepo

				// Record sync start time for stale command detection
				const syncStartTime = new Date()

				// Upsert each command (updates updatedAt to now)
				let syncedCount = 0
				for (const cmd of payload.commands) {
					yield* commandRepo.upsert({
						botId: bot.id,
						name: cmd.name,
						description: cmd.description,
						arguments: cmd.arguments.map((arg) => ({
							name: arg.name,
							description: arg.description ?? null,
							required: arg.required,
							placeholder: arg.placeholder ?? null,
							type: arg.type,
						})),
						usageExample: cmd.usageExample ?? null,
					})
					syncedCount++
				}

				// Delete commands not touched by this sync (stale commands)
				yield* commandRepo.deleteStaleCommands(bot.id, syncStartTime)

				return new SyncBotCommandsResponse({ syncedCount })
			}).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while syncing commands",
							detail: String(error),
						}),
					),
				),
			),
		)
		// Execute a bot command (user auth)
		.handle("executeBotCommand", ({ params, payload }) =>
			Effect.gen(function* () {
				const currentUser = yield* CurrentUser.Context
				const { orgId, botId, commandName } = params
				const { channelId, arguments: args } = payload

				const botRepo = yield* BotRepo
				const commandRepo = yield* BotCommandRepo
				const installationRepo = yield* BotInstallationRepo
				const botGateway = yield* BotGatewayService

				// Verify bot exists
				const botOption = yield* botRepo.findById(botId)
				if (Option.isNone(botOption)) {
					return yield* Effect.fail(new BotNotFoundError({ botId }))
				}

				const bot = botOption.value

				// Verify bot is installed in this org
				const isInstalled = yield* installationRepo.isInstalled(botId, orgId)
				if (!isInstalled) {
					return yield* Effect.fail(new BotNotInstalledError({ botId, orgId }))
				}

				// Find the command
				const commandOption = yield* commandRepo.findByBotAndName(botId, commandName)
				if (Option.isNone(commandOption)) {
					return yield* Effect.fail(new BotCommandNotFoundError({ botId, commandName }))
				}

				const command = commandOption.value

				// Verify command is enabled
				if (!command.isEnabled) {
					return yield* Effect.fail(new BotCommandNotFoundError({ botId, commandName }))
				}

				// Build arguments map
				const argsMap: Record<string, string> = {}
				for (const arg of args) {
					argsMap[arg.name] = arg.value
				}

				// Append command event to the durable bot gateway stream
				const commandEvent = {
					type: "command" as const,
					commandName,
					channelId,
					userId: currentUser.id,
					orgId,
					arguments: argsMap,
					timestamp: Date.now(),
				}

				yield* botGateway.publishCommand(botId, {
					commandName: commandEvent.commandName,
					channelId: commandEvent.channelId,
					userId: commandEvent.userId,
					orgId: commandEvent.orgId,
					arguments: commandEvent.arguments,
					timestamp: commandEvent.timestamp,
				})

				yield* Effect.logDebug(`Appended command ${commandName} to durable gateway for bot ${botId}`)

				return new BotCommandExecutionAccepted({
					message: "Command sent to bot",
				})
			}).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while executing command",
							detail: String(error),
						}),
					),
				),
				Effect.catchTag("DurableStreamRequestError", (error) =>
					Effect.fail(
						new BotCommandExecutionError({
							commandName: params.commandName,
							message: "Failed to append command to bot gateway",
							details: String(error.message),
						}),
					),
				),
			),
		)
		// Get integration token (bot token auth)
		.handle("getIntegrationToken", ({ params }) =>
			Effect.gen(function* () {
				const bot = yield* validateBotToken
				const { orgId, provider } = params

				// Check provider is in bot's allowedIntegrations
				const allowed = bot.allowedIntegrations ?? []
				if (!allowed.includes(provider)) {
					return yield* Effect.fail(new IntegrationNotAllowedError({ botId: bot.id, provider }))
				}

				// Verify bot is installed in this org
				const installationRepo = yield* BotInstallationRepo
				const isInstalled = yield* installationRepo.isInstalled(bot.id, orgId)
				if (!isInstalled) {
					return yield* Effect.fail(new BotNotInstalledError({ botId: bot.id, orgId }))
				}

				// Find active integration connection for the org
				const connectionRepo = yield* IntegrationConnectionRepo
				const connectionOption = yield* connectionRepo.findOrgConnection(orgId, provider)

				if (Option.isNone(connectionOption)) {
					return yield* Effect.fail(new IntegrationNotConnectedError({ provider }))
				}

				const connection = connectionOption.value

				// Verify connection is active
				if (connection.status !== "active") {
					return yield* Effect.fail(new IntegrationNotConnectedError({ provider }))
				}

				// Get valid (auto-refreshed) access token
				const tokenService = yield* IntegrationTokenService
				const accessToken = yield* tokenService.getValidAccessToken(connection.id)

				yield* Effect.logInfo("AUDIT: Bot accessed integration token", {
					event: "bot_integration_token_access",
					botId: bot.id,
					orgId,
					provider,
				})

				return new IntegrationTokenResponse({
					accessToken,
					provider,
					expiresAt: connection.lastUsedAt?.toISOString() ?? null,
					settings: connection.settings as Record<string, unknown> | null,
				})
			}).pipe(
				Effect.catchTag("DatabaseError", () =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while fetching integration token",
							detail: "Database error",
						}),
					),
				),
				Effect.catchTag("TokenNotFoundError", () =>
					Effect.fail(new IntegrationNotConnectedError({ provider: params.provider })),
				),
				Effect.catchTag("TokenRefreshError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: `Failed to refresh ${params.provider} token`,
							detail: String(error.cause),
						}),
					),
				),
				Effect.catchTag("ConnectionNotFoundError", () =>
					Effect.fail(new IntegrationNotConnectedError({ provider: params.provider })),
				),
				Effect.catchTag("IntegrationEncryptionError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: `Failed to decrypt ${params.provider} token`,
							detail: String(error),
						}),
					),
				),
				Effect.catchTag("KeyVersionNotFoundError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: `Encryption key version not found for ${params.provider} token`,
							detail: String(error),
						}),
					),
				),
			),
		)
		// Get enabled integrations (bot token auth)
		.handle("getEnabledIntegrations", ({ params }) =>
			Effect.gen(function* () {
				const bot = yield* validateBotToken
				const { orgId } = params

				// Verify bot is installed in this org
				const installationRepo = yield* BotInstallationRepo
				const isInstalled = yield* installationRepo.isInstalled(bot.id, orgId)
				if (!isInstalled) {
					return yield* Effect.fail(new BotNotInstalledError({ botId: bot.id, orgId }))
				}

				// Get bot's allowed integrations
				const allowedIntegrations = bot.allowedIntegrations ?? []
				if (allowedIntegrations.length === 0) {
					return new EnabledIntegrationsResponse({ providers: [] })
				}

				// Find active integration connections for the org
				const connectionRepo = yield* IntegrationConnectionRepo
				const activeConnections = yield* connectionRepo.findActiveOrgConnections(orgId)

				// Compute intersection: providers that are both allowed AND connected
				const activeProviders = new Set(activeConnections.map((c) => c.provider))
				const enabledProviders = allowedIntegrations.filter((provider) =>
					activeProviders.has(provider),
				)

				return new EnabledIntegrationsResponse({ providers: enabledProviders })
			}).pipe(
				Effect.catchTag("DatabaseError", () =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while fetching enabled integrations",
							detail: "Database error",
						}),
					),
				),
			),
		)
		// Update bot settings (bot token auth)
		.handle("updateBotSettings", ({ payload }) =>
			Effect.gen(function* () {
				const bot = yield* validateBotToken
				const botRepo = yield* BotRepo

				// Build update object with only provided fields
				const updates: { id: typeof bot.id; mentionable?: boolean } = { id: bot.id }

				if (payload.mentionable !== undefined) {
					updates.mentionable = payload.mentionable
				}

				// Only update if there are fields to update
				if (Object.keys(updates).length > 1) {
					yield* botRepo.update(updates)
					yield* Effect.logDebug(`Updated bot ${bot.id} settings`, { updates })
				}

				return new UpdateBotSettingsResponse({ success: true })
			}).pipe(
				Effect.catchTag("DatabaseError", () =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while updating bot settings",
							detail: "Database error",
						}),
					),
				),
			),
		),
)
