import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { BotId, ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { IntegrationConnection } from "../models"
import { CommandArgumentValue } from "./integration-commands"
import { IntegrationNotConnectedError } from "./integrations"
import { RequiredScopes } from "../scopes/required-scopes"

// Re-export IntegrationProvider for convenience
const IntegrationProvider = IntegrationConnection.IntegrationProvider

// ============ SHARED SCHEMAS ============

export const BotCommandArgumentSchema = Schema.Struct({
	name: Schema.String,
	description: Schema.NullishOr(Schema.String),
	required: Schema.Boolean,
	placeholder: Schema.NullishOr(Schema.String),
	type: Schema.Literals(["string", "number", "user", "channel"]),
})
export type BotCommandArgumentSchema = typeof BotCommandArgumentSchema.Type

export const BotCommandSchema = Schema.Struct({
	name: Schema.String,
	description: Schema.String,
	arguments: Schema.Array(BotCommandArgumentSchema),
	usageExample: Schema.NullishOr(Schema.String),
})
export type BotCommandSchema = typeof BotCommandSchema.Type

// ============ REQUEST SCHEMAS ============

export class SyncBotCommandsRequest extends Schema.Class<SyncBotCommandsRequest>("SyncBotCommandsRequest")({
	commands: Schema.Array(BotCommandSchema),
}) {}

export class ExecuteBotCommandRequest extends Schema.Class<ExecuteBotCommandRequest>(
	"ExecuteBotCommandRequest",
)({
	channelId: ChannelId,
	arguments: Schema.Array(CommandArgumentValue),
}) {}

// ============ RESPONSE SCHEMAS ============

export class SyncBotCommandsResponse extends Schema.Class<SyncBotCommandsResponse>("SyncBotCommandsResponse")(
	{
		syncedCount: Schema.Number,
	},
) {}

export class BotCommandExecutionAccepted extends Schema.Class<BotCommandExecutionAccepted>(
	"BotCommandExecutionAccepted",
)({
	message: Schema.String,
}) {}

export class BotMeResponse extends Schema.Class<BotMeResponse>("BotMeResponse")({
	botId: BotId,
	userId: UserId,
	name: Schema.String,
}) {}

// ============ ERROR TYPES ============

export class BotNotFoundError extends Schema.TaggedError<BotNotFoundError>()("BotNotFoundError", {
	botId: BotId,
}) {}

export class BotNotInstalledError extends Schema.TaggedError<BotNotInstalledError>()("BotNotInstalledError", {
	botId: BotId,
	orgId: OrganizationId,
}) {}

export class BotCommandNotFoundError extends Schema.TaggedError<BotCommandNotFoundError>()(
	"BotCommandNotFoundError",
	{
		botId: BotId,
		commandName: Schema.String,
	},
) {}

export class BotCommandExecutionError extends Schema.TaggedError<BotCommandExecutionError>()(
	"BotCommandExecutionError",
	{
		commandName: Schema.String,
		message: Schema.String,
		details: Schema.NullishOr(Schema.String),
	},
) {}

// ============ INTEGRATION TOKEN SCHEMAS ============

export class IntegrationTokenResponse extends Schema.Class<IntegrationTokenResponse>(
	"IntegrationTokenResponse",
)({
	accessToken: Schema.String,
	provider: IntegrationProvider,
	expiresAt: Schema.NullOr(Schema.String),
	settings: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
}) {}

export class EnabledIntegrationsResponse extends Schema.Class<EnabledIntegrationsResponse>(
	"EnabledIntegrationsResponse",
)({
	providers: Schema.Array(IntegrationProvider),
}) {}

export class UpdateBotSettingsRequest extends Schema.Class<UpdateBotSettingsRequest>(
	"UpdateBotSettingsRequest",
)({
	mentionable: Schema.optional(Schema.Boolean),
}) {}

export class UpdateBotSettingsResponse extends Schema.Class<UpdateBotSettingsResponse>(
	"UpdateBotSettingsResponse",
)({
	success: Schema.Boolean,
}) {}

export class IntegrationNotAllowedError extends Schema.TaggedError<IntegrationNotAllowedError>()(
	"IntegrationNotAllowedError",
	{
		botId: BotId,
		provider: IntegrationProvider,
	},
) {}

// ============ API GROUP ============

export class BotCommandsApiGroup extends HttpApiGroup.make("bot-commands")
	// SSE stream for bot commands (bot token auth)
	// This endpoint uses bot token authentication, not user auth
	.add(
		HttpApiEndpoint.get("streamCommands", `/stream`, {
			error: UnauthorizedError,
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Stream Bot Commands",
					description: "SSE stream for receiving bot commands (used by Bot SDK)",
					summary: "Stream commands via SSE",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	// Get current bot info (for bot token validation)
	// This endpoint uses bot token authentication, not user auth
	.add(
		HttpApiEndpoint.get("getBotMe", `/me`, {
			success: BotMeResponse,
			error: UnauthorizedError,
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Bot Info",
					description: "Get current bot info from token (used by Bot SDK for authentication)",
					summary: "Get bot info",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	// Sync commands from bot (called by Bot SDK on startup)
	// This endpoint uses bot token authentication, not user auth
	.add(
		HttpApiEndpoint.post("syncCommands", `/sync`, {
			payload: SyncBotCommandsRequest,
			success: SyncBotCommandsResponse,
			error: [BotNotFoundError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Sync Bot Commands",
					description: "Sync slash commands from a bot (called by Bot SDK on startup)",
					summary: "Register bot commands",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	// Execute a bot command (frontend calls this - requires user auth)
	.add(
		HttpApiEndpoint.post("executeBotCommand", `/:orgId/bots/:botId/commands/:commandName/execute`, {
			params: {
				orgId: OrganizationId,
				botId: BotId,
				commandName: Schema.String,
			},
			payload: ExecuteBotCommandRequest,
			success: BotCommandExecutionAccepted,
			error: [
				BotNotFoundError,
				BotNotInstalledError,
				BotCommandNotFoundError,
				BotCommandExecutionError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Execute Bot Command",
					description: "Execute a slash command for a bot",
					summary: "Execute bot command",
				}),
			)
			.annotate(RequiredScopes, ["bots:write"])
			.middleware(CurrentUser.Authorization),
	)
	// Get integration token (bot token auth)
	// Bot must have the provider in its allowedIntegrations and be installed in the org
	.add(
		HttpApiEndpoint.get("getIntegrationToken", `/integrations/:orgId/:provider/token`, {
			params: {
				orgId: OrganizationId,
				provider: IntegrationProvider,
			},
			success: IntegrationTokenResponse,
			error: [
				UnauthorizedError,
				BotNotInstalledError,
				IntegrationNotConnectedError,
				IntegrationNotAllowedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Integration Token",
					description:
						"Get a valid OAuth access token for an integration provider. Bot must have the provider in its allowedIntegrations and be installed in the target org.",
					summary: "Get integration token",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	// Get enabled integrations (bot token auth)
	// Returns the intersection of bot's allowedIntegrations and org's active connections
	.add(
		HttpApiEndpoint.get("getEnabledIntegrations", `/integrations/:orgId/enabled`, {
			params: {
				orgId: OrganizationId,
			},
			success: EnabledIntegrationsResponse,
			error: [UnauthorizedError, BotNotInstalledError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Enabled Integrations",
					description:
						"Get the list of integration providers enabled for the bot in the target org. Returns the intersection of the bot's allowedIntegrations and the org's active integration connections.",
					summary: "Get enabled integrations",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	// Update bot settings (bot token auth)
	// Allows bots to update their own settings like mentionable flag
	.add(
		HttpApiEndpoint.patch("updateBotSettings", `/settings`, {
			payload: UpdateBotSettingsRequest,
			success: UpdateBotSettingsResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Update Bot Settings",
					description:
						"Update the bot's settings. Currently supports updating the mentionable flag which controls whether the bot can be @mentioned in messages.",
					summary: "Update bot settings",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/bot-commands") {}
