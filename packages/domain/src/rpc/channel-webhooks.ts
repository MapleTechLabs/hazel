import { Rpc, RpcGroup } from "effect/rpc"
import { AvatarUrl, ChannelId, ChannelWebhookId } from "@hazel/schema"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChannelWebhook } from "../models"
import { TransactionId } from "@hazel/schema"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for webhook operations.
 * Contains the webhook data and a transaction ID for optimistic updates.
 */
export class ChannelWebhookResponse extends Schema.Class<ChannelWebhookResponse>("ChannelWebhookResponse")({
	data: ChannelWebhook.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Response for webhook creation - includes the plain token (only shown once).
 */
export class ChannelWebhookCreatedResponse extends Schema.Class<ChannelWebhookCreatedResponse>(
	"ChannelWebhookCreatedResponse",
)({
	data: ChannelWebhook.Schema,
	token: Schema.String, // Plain token, only returned once on creation
	webhookUrl: Schema.String, // Full URL for the webhook
	transactionId: TransactionId,
}) {}

/**
 * Response for listing webhooks for a channel.
 */
export class ChannelWebhookListResponse extends Schema.Class<ChannelWebhookListResponse>(
	"ChannelWebhookListResponse",
)({
	data: Schema.Array(ChannelWebhook.Schema),
}) {}

/**
 * Error thrown when a webhook is not found.
 */
export class ChannelWebhookNotFoundError extends Schema.TaggedError<ChannelWebhookNotFoundError>()(
	"ChannelWebhookNotFoundError",
	{
		webhookId: ChannelWebhookId,
	},
) {}

/**
 * Channel Webhook RPC Group
 *
 * Defines all RPC methods for channel webhook operations:
 * - channelWebhook.create: Create a new webhook for a channel
 * - channelWebhook.list: List all webhooks for a channel
 * - channelWebhook.update: Update webhook configuration
 * - channelWebhook.regenerateToken: Generate a new token for a webhook
 * - channelWebhook.delete: Delete a webhook
 *
 * All methods require authentication via AuthMiddleware.
 * Only organization admins can manage webhooks.
 */
export class ChannelWebhookRpcs extends RpcGroup.make(
	/**
	 * channelWebhook.create
	 *
	 * Creates a new webhook for a channel.
	 * A new bot user is created for this webhook.
	 * Returns the webhook data including the plain token (only shown once).
	 *
	 * @param payload - Channel ID, webhook name, optional description and avatar
	 * @returns Webhook data, plain token, webhook URL, and transaction ID
	 * @throws ChannelNotFoundError if channel doesn't exist
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("channelWebhook.create", {
		payload: Schema.Struct({
			channelId: ChannelId,
			name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
			description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
			avatarUrl: Schema.optional(AvatarUrl),
			/** When set, uses a global integration bot user instead of creating a unique webhook bot */
			integrationProvider: Schema.optional(Schema.Literals(["openstatus", "railway", "maple"])),
		}),
		success: ChannelWebhookCreatedResponse,
		error: Schema.Union([ChannelNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-webhooks:write"])
		.middleware(AuthMiddleware),

	/**
	 * channelWebhook.list
	 *
	 * Lists all webhooks for a channel.
	 *
	 * @param payload - Channel ID
	 * @returns Array of webhooks (without token hashes)
	 * @throws ChannelNotFoundError if channel doesn't exist
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("channelWebhook.list", {
		payload: Schema.Struct({ channelId: ChannelId }),
		success: ChannelWebhookListResponse,
		error: Schema.Union([ChannelNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-webhooks:read"])
		.middleware(AuthMiddleware),

	/**
	 * channelWebhook.update
	 *
	 * Updates webhook configuration (name, description, avatar, enabled).
	 *
	 * @param payload - Webhook ID and fields to update
	 * @returns Updated webhook data and transaction ID
	 * @throws ChannelWebhookNotFoundError if webhook doesn't exist
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("channelWebhook.update", {
		payload: Schema.Struct({
			id: ChannelWebhookId,
			name: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
			description: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(500)))),
			avatarUrl: Schema.optional(Schema.NullOr(AvatarUrl)),
			isEnabled: Schema.optional(Schema.Boolean),
		}),
		success: ChannelWebhookResponse,
		error: Schema.Union([ChannelWebhookNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-webhooks:write"])
		.middleware(AuthMiddleware),

	/**
	 * channelWebhook.regenerateToken
	 *
	 * Generates a new token for a webhook.
	 * The old token is invalidated immediately.
	 *
	 * @param payload - Webhook ID
	 * @returns Webhook data with new token and URL
	 * @throws ChannelWebhookNotFoundError if webhook doesn't exist
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("channelWebhook.regenerateToken", {
		payload: Schema.Struct({ id: ChannelWebhookId }),
		success: ChannelWebhookCreatedResponse,
		error: Schema.Union([ChannelWebhookNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-webhooks:write"])
		.middleware(AuthMiddleware),

	/**
	 * channelWebhook.delete
	 *
	 * Deletes a webhook (soft delete).
	 *
	 * @param payload - Webhook ID
	 * @returns Transaction ID
	 * @throws ChannelWebhookNotFoundError if webhook doesn't exist
	 * @throws UnauthorizedError if user is not org admin
	 */
	Rpc.make("channelWebhook.delete", {
		payload: Schema.Struct({ id: ChannelWebhookId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ChannelWebhookNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-webhooks:write"])
		.middleware(AuthMiddleware),

	/**
	 * channelWebhook.listByOrganization
	 *
	 * Lists all webhooks for the user's organization.
	 * Used by the integration settings page to show all configured webhooks.
	 *
	 * @returns Array of webhooks across all channels in the organization
	 * @throws UnauthorizedError if user is not authenticated
	 */
	Rpc.make("channelWebhook.listByOrganization", {
		payload: Schema.Struct({}),
		success: ChannelWebhookListResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-webhooks:read"])
		.middleware(AuthMiddleware),
) {}
