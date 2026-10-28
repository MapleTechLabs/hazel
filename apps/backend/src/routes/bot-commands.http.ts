/**
 * Bot command routes in the api Worker, over the directory (D1): `bots` and `bot_commands` are its
 * rows, so the SDK's command sync and settings write there and fan out to the orgs' copies.
 * Integration tokens and connections are the `OrgObject`'s (`worker/objects/org/integrations.ts`).
 */
import { HttpApiBuilder } from "effect/http-api"
import { SQLite, schema } from "@hazel/db"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { BotCommandRepo, BotRepo } from "@hazel/backend-core"
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
import type { BotId, OrganizationId, UserId } from "@hazel/schema"
import { DateTime, Effect, Option, Stream } from "effect"
import { HazelApi } from "../api.ts"
import { Directory } from "../services/directory.ts"
import { botProjection, DirectoryWireOrgEffects } from "../worker/objects/directory-wire.ts"
import { fanOut } from "../worker/objects/fanout.ts"
import { orgTarget } from "../worker/objects/kinds.ts"
import { BotGatewayService } from "../services/bot-gateway-service.ts"
import { callObject } from "../worker/objects/calls.ts"
import { ActiveIntegrationsCall, IntegrationAccessTokenCall } from "../worker/objects/org/integrations.ts"
import { createSseHeartbeatStream } from "./bot-commands.sse.ts"

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

const toIso = (value: Date | DateTime.Utc | null) =>
	value === null ? null : DateTime.isDateTime(value) ? DateTime.formatIso(value) : value.toISOString()

/**
 * The bot's installation is the bot user's active membership in the directory's
 * `membership_index` (the `OrgObject` owns `bot_installations` and keeps the index current).
 */
const isInstalled = (botUserId: UserId, orgId: OrganizationId) =>
	Effect.flatMap(Directory, (directory) => directory.membership(botUserId, orgId)).pipe(
		Effect.map((row) => Option.isSome(row) && row.value.deletedAt === null),
	)

/** Copy the directory's bot (and its commands) to the orgs it is installed in. */
const projectBot = Effect.fn("BotCommands.projectBot")(function* (botId: BotId, withCommands: boolean) {
	const directory = yield* Directory
	const bot = yield* directory.db.first(
		SQLite.from(schema.botsTable)
			.select()
			.where(($) => [$.id.eq(botId)])
			.limit(1),
	)
	if (Option.isNone(bot)) return
	const commands = withCommands
		? yield* directory.db.run(
				SQLite.from(schema.botCommandsTable)
					.select()
					.where(($) => [$.botId.eq(botId)]),
			)
		: null
	const organizations = yield* directory.organizationsOf(bot.value.userId)
	yield* fanOut(
		DirectoryWireOrgEffects.upsertBotProjection,
		organizations.map(orgTarget),
		botProjection(bot.value, commands),
		crypto.randomUUID(),
	)
})

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

				yield* Effect.logInfo(`Bot ${bot.id} (${bot.name}) connecting to SSE stream`)

				// Commands are delivered through the bot gateway (`BotGatewayService.publishCommand`);
				// this stream only keeps legacy SSE clients' connections alive.
				const sseStream = createSseHeartbeatStream().pipe(Stream.encodeText)

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
				yield* projectBot(bot.id, true)

				return new SyncBotCommandsResponse({ syncedCount })
			}).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.fail(
						new InternalServerError({
							message: "Database error while syncing commands",
							cause: error,
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
				const botGateway = yield* BotGatewayService

				// Verify bot exists
				const botOption = yield* botRepo.findById(botId)
				if (Option.isNone(botOption)) {
					return yield* Effect.fail(new BotNotFoundError({ botId }))
				}

				const bot = botOption.value

				// Verify bot is installed in this org
				if (!(yield* isInstalled(bot.userId, orgId))) {
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
							cause: error,
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
				if (!(yield* isInstalled(bot.userId, orgId))) {
					return yield* Effect.fail(new BotNotInstalledError({ botId: bot.id, orgId }))
				}

				// The org's active connection and a valid (auto-refreshed) token, from its object.
				const token = yield* callObject(IntegrationAccessTokenCall, orgTarget(orgId), { provider })
				if (token === null) {
					return yield* Effect.fail(new IntegrationNotConnectedError({ provider }))
				}
				const { accessToken, connection } = token

				yield* Effect.logInfo("AUDIT: Bot accessed integration token", {
					event: "bot_integration_token_access",
					botId: bot.id,
					orgId,
					provider,
				})

				return new IntegrationTokenResponse({
					accessToken,
					provider,
					expiresAt: toIso(connection.lastUsedAt),
					settings: connection.settings as Record<string, unknown> | null,
				})
			}).pipe(
				Effect.catchTags({
					DatabaseError: () =>
						Effect.fail(
							new InternalServerError({
								message: "Database error while fetching integration token",
								detail: "Database error",
							}),
						),
					IntegrationTokenUnavailableError: (error) =>
						Effect.fail(new InternalServerError({ message: error.message, cause: error })),
					ObjectCallError: (error) =>
						Effect.fail(
							new InternalServerError({
								message: "The organization is unavailable",
								cause: error,
							}),
						),
				}),
			),
		)
		// Get enabled integrations (bot token auth)
		.handle("getEnabledIntegrations", ({ params }) =>
			Effect.gen(function* () {
				const bot = yield* validateBotToken
				const { orgId } = params

				// Verify bot is installed in this org
				if (!(yield* isInstalled(bot.userId, orgId))) {
					return yield* Effect.fail(new BotNotInstalledError({ botId: bot.id, orgId }))
				}

				// Get bot's allowed integrations
				const allowedIntegrations = bot.allowedIntegrations ?? []
				if (allowedIntegrations.length === 0) {
					return new EnabledIntegrationsResponse({ providers: [] })
				}

				// Providers that are both allowed AND connected (the org's active connections)
				const activeProviders = new Set(
					yield* callObject(ActiveIntegrationsCall, orgTarget(orgId), {}),
				)
				const enabledProviders = allowedIntegrations.filter((provider) =>
					activeProviders.has(provider),
				)

				return new EnabledIntegrationsResponse({ providers: enabledProviders })
			}).pipe(
				Effect.catchTags({
					DatabaseError: () =>
						Effect.fail(
							new InternalServerError({
								message: "Database error while fetching enabled integrations",
								detail: "Database error",
							}),
						),
					ObjectCallError: (error) =>
						Effect.fail(
							new InternalServerError({
								message: "The organization is unavailable",
								cause: error,
							}),
						),
				}),
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
					yield* projectBot(bot.id, false)
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
