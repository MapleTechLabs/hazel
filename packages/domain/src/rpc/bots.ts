import { Rpc, RpcGroup } from "effect/rpc"
import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { Bot, BotCommand } from "../models"
import { RateLimitExceededError } from "../rate-limit-errors"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"
import { ApiScope } from "../scopes/api-scope"

/**
 * Response schema for bot operations.
 * Contains the bot data and a transaction ID for optimistic updates.
 */
export class BotResponse extends Schema.Class<BotResponse>("BotResponse")({
	data: Bot.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Response for bot creation - includes the plain token (only shown once).
 */
export class BotCreatedResponse extends Schema.Class<BotCreatedResponse>("BotCreatedResponse")({
	data: Bot.Schema,
	token: Schema.String, // Plain token, only returned once on creation
	transactionId: TransactionId,
}) {}

/**
 * Response for listing bots.
 */
export class BotListResponse extends Schema.Class<BotListResponse>("BotListResponse")({
	data: Schema.Array(Bot.Schema),
}) {}

/**
 * Response for listing bot commands.
 */
export class BotCommandListResponse extends Schema.Class<BotCommandListResponse>("BotCommandListResponse")({
	data: Schema.Array(BotCommand.Schema),
}) {}

/**
 * Public bot info for marketplace - includes install status and creator name.
 */
export const PublicBotInfo = Schema.Struct({
	...Bot.Schema.fields,
	isInstalled: Schema.Boolean,
	creatorName: Schema.String,
})
export type PublicBotInfo = typeof PublicBotInfo.Type

/**
 * Response for listing public bots in the marketplace.
 */
export class PublicBotListResponse extends Schema.Class<PublicBotListResponse>("PublicBotListResponse")({
	data: Schema.Array(PublicBotInfo),
}) {}

/**
 * Error thrown when a bot is not found.
 */
export class BotNotFoundError extends Schema.TaggedError<BotNotFoundError>()("BotNotFoundError", {
	botId: BotId,
}) {}

/**
 * Error thrown when a bot is already installed in the organization.
 */
export class BotAlreadyInstalledError extends Schema.TaggedError<BotAlreadyInstalledError>()(
	"BotAlreadyInstalledError",
	{
		botId: BotId,
	},
) {}

/**
 * Bot RPC Group
 *
 * Defines all RPC methods for bot operations:
 *
 * Bot Management (for bot creators):
 * - bot.create: Create a new bot with scopes/permissions
 * - bot.list: List all bots created by the user/organization
 * - bot.get: Get a single bot by ID
 * - bot.update: Update bot configuration
 * - bot.delete: Delete a bot
 * - bot.regenerateToken: Generate a new API token for a bot
 * - bot.getCommands: List all commands registered by a bot
 *
 * Bot Marketplace (for bot users):
 * - bot.listPublic: Browse public bots available for installation
 * - bot.listInstalled: List bots installed in the user's organization
 * - bot.install: Install a public bot to the organization
 * - bot.uninstall: Remove a bot from the organization
 *
 * All methods require authentication via AuthMiddleware.
 */
export class BotRpcs extends RpcGroup.make(
	// === Bot Management (for bot creators) ===

	/**
	 * bot.create
	 *
	 * Creates a new bot with specified scopes/permissions.
	 * A machine user is created for the bot, and an API token is generated.
	 * Returns the bot data including the plain token (only shown once).
	 *
	 * @param payload - Bot name, description, webhook URL, scopes, and public visibility
	 * @returns Bot data, plain token, and transaction ID
	 * @throws UnauthorizedError if user is not authenticated
	 */
	Rpc.make("bot.create", {
		payload: Schema.Struct({
			name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
			description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
			webhookUrl: Schema.optional(Schema.String),
			scopes: Schema.Array(ApiScope),
			isPublic: Schema.optional(Schema.Boolean),
		}),
		success: BotCreatedResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError, RateLimitExceededError]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.list
	 *
	 * Lists all bots created by users in the organization.
	 *
	 * @returns Array of bots
	 * @throws UnauthorizedError if user is not authenticated
	 */
	Rpc.make("bot.list", {
		payload: Schema.Struct({}),
		success: BotListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:read"])
		.middleware(AuthMiddleware),

	/**
	 * bot.get
	 *
	 * Gets a single bot by ID.
	 *
	 * @param payload - Bot ID
	 * @returns Bot data
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws UnauthorizedError if user is not org admin or bot creator
	 */
	Rpc.make("bot.get", {
		payload: Schema.Struct({ id: BotId }),
		success: BotResponse,
		error: Schema.Union([BotNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:read"])
		.middleware(AuthMiddleware),

	/**
	 * bot.update
	 *
	 * Updates bot configuration (name, description, webhook URL, scopes, visibility).
	 *
	 * @param payload - Bot ID and fields to update
	 * @returns Updated bot data and transaction ID
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws UnauthorizedError if user is not org admin or bot creator
	 */
	Rpc.make("bot.update", {
		payload: Schema.Struct({
			id: BotId,
			name: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
			description: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(500)))),
			webhookUrl: Schema.optional(Schema.NullOr(Schema.String)),
			scopes: Schema.optional(Schema.Array(ApiScope)),
			isPublic: Schema.optional(Schema.Boolean),
		}),
		success: BotResponse,
		error: Schema.Union([
			BotNotFoundError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.delete
	 *
	 * Deletes a bot (soft delete).
	 *
	 * @param payload - Bot ID
	 * @returns Transaction ID
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws UnauthorizedError if user is not org admin or bot creator
	 */
	Rpc.make("bot.delete", {
		payload: Schema.Struct({ id: BotId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([BotNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.regenerateToken
	 *
	 * Generates a new API token for a bot.
	 * The old token is invalidated immediately.
	 *
	 * @param payload - Bot ID
	 * @returns Bot data with new token
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws UnauthorizedError if user is not org admin or bot creator
	 */
	Rpc.make("bot.regenerateToken", {
		payload: Schema.Struct({ id: BotId }),
		success: BotCreatedResponse,
		error: Schema.Union([
			BotNotFoundError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.getCommands
	 *
	 * Lists all commands registered by a bot.
	 *
	 * @param payload - Bot ID
	 * @returns Array of bot commands
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("bot.getCommands", {
		payload: Schema.Struct({ botId: BotId }),
		success: BotCommandListResponse,
		error: Schema.Union([BotNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:read"])
		.middleware(AuthMiddleware),

	// === Bot Marketplace (for bot users) ===

	/**
	 * bot.listPublic
	 *
	 * Lists all public bots available for installation.
	 * Returns bots with their install status for the user's organization.
	 *
	 * @param payload - Optional search query
	 * @returns Array of public bots with install status
	 * @throws UnauthorizedError if user is not authenticated
	 */
	Rpc.make("bot.listPublic", {
		payload: Schema.Struct({
			search: Schema.optional(Schema.String),
		}),
		success: PublicBotListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:read"])
		.middleware(AuthMiddleware),

	/**
	 * bot.listInstalled
	 *
	 * Lists all bots installed in the user's organization.
	 *
	 * @returns Array of installed bots
	 * @throws UnauthorizedError if user is not authenticated
	 */
	Rpc.make("bot.listInstalled", {
		payload: Schema.Struct({}),
		success: BotListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:read"])
		.middleware(AuthMiddleware),

	/**
	 * bot.install
	 *
	 * Installs a public bot to the user's organization.
	 *
	 * @param payload - Bot ID
	 * @returns Transaction ID
	 * @throws BotNotFoundError if bot doesn't exist or is not public
	 * @throws BotAlreadyInstalledError if bot is already installed
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("bot.install", {
		payload: Schema.Struct({ botId: BotId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			BotNotFoundError,
			BotAlreadyInstalledError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.uninstall
	 *
	 * Removes a bot from the user's organization.
	 *
	 * @param payload - Bot ID
	 * @returns Transaction ID
	 * @throws BotNotFoundError if bot is not installed
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("bot.uninstall", {
		payload: Schema.Struct({ botId: BotId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			BotNotFoundError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.installById
	 *
	 * Installs a bot by ID, regardless of whether it's public or private.
	 * This allows users to install apps by sharing their bot ID.
	 *
	 * @param payload - Bot ID
	 * @returns Transaction ID
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws BotAlreadyInstalledError if bot is already installed
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("bot.installById", {
		payload: Schema.Struct({ botId: BotId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			BotNotFoundError,
			BotAlreadyInstalledError,
			UnauthorizedError,
			InternalServerError,
			RateLimitExceededError,
		]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),

	/**
	 * bot.updateAvatar
	 *
	 * Updates the bot's avatar URL.
	 * This updates the machine user's avatarUrl associated with the bot.
	 *
	 * @param payload - Bot ID and new avatar URL
	 * @returns Updated bot data and transaction ID
	 * @throws BotNotFoundError if bot doesn't exist
	 * @throws UnauthorizedError if user is not bot creator
	 */
	Rpc.make("bot.updateAvatar", {
		payload: Schema.Struct({
			id: BotId,
			avatarUrl: Schema.String,
		}),
		success: BotResponse,
		error: Schema.Union([BotNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["bots:write"])
		.middleware(AuthMiddleware),
) {}
