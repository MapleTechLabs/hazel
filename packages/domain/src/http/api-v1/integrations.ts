import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { AvatarUrl, ChannelId, ChannelWebhookId, OrganizationId } from "@hazel/schema"
import { InternalServerError, UnauthorizedError } from "../../errors"
import { ChannelType } from "../../models/channel-model"

/**
 * Public API v1 — programmatic counterpart to the manual "create a webhook in
 * a channel" flow used by integrations like Maple, OpenStatus, Railway. Lets
 * an OAuth-authenticated client list the user's organizations and channels,
 * then provision a channel webhook bound to a known integration provider so
 * the integration delivery path (the existing /webhooks/incoming/...) takes
 * care of formatting and posting.
 *
 * Auth: Bearer access tokens issued by Hazel's Clerk OAuth Applications.
 */

// ============ MODELS ============

export class ApiV1OrganizationSummary extends Schema.Class<ApiV1OrganizationSummary>(
	"ApiV1OrganizationSummary",
)({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
}) {}

export class ApiV1OrganizationsListResponse extends Schema.Class<ApiV1OrganizationsListResponse>(
	"ApiV1OrganizationsListResponse",
)({
	data: Schema.Array(ApiV1OrganizationSummary),
}) {}

export class ApiV1ChannelSummary extends Schema.Class<ApiV1ChannelSummary>("ApiV1ChannelSummary")({
	id: ChannelId,
	name: Schema.String,
	type: ChannelType,
	organizationId: OrganizationId,
}) {}

export class ApiV1ChannelsListResponse extends Schema.Class<ApiV1ChannelsListResponse>(
	"ApiV1ChannelsListResponse",
)({
	data: Schema.Array(ApiV1ChannelSummary),
}) {}

// ============ REQUEST / RESPONSE ============

export class ApiV1CreateChannelWebhookRequest extends Schema.Class<ApiV1CreateChannelWebhookRequest>(
	"ApiV1CreateChannelWebhookRequest",
)({
	channelId: ChannelId,
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
	avatarUrl: Schema.optional(AvatarUrl),
	/** Bind the webhook to a known integration provider for embed formatting / shared bot identity. */
	integrationProvider: Schema.optional(Schema.Literals(["openstatus", "railway", "maple"])),
}) {}

export class ApiV1ChannelWebhookCreatedResponse extends Schema.Class<ApiV1ChannelWebhookCreatedResponse>(
	"ApiV1ChannelWebhookCreatedResponse",
)({
	id: ChannelWebhookId,
	channelId: ChannelId,
	organizationId: OrganizationId,
	name: Schema.String,
	webhookUrl: Schema.String,
	/** Plain token — only returned on creation. Treat as a secret. */
	token: Schema.String,
}) {}

// ============ ERRORS ============

export class ApiV1ChannelNotFoundError extends Schema.TaggedError<ApiV1ChannelNotFoundError>()(
	"ApiV1ChannelNotFoundError",
	{
		channelId: ChannelId,
		message: Schema.String,
	},
	{ httpApiStatus: 404 },
) {}

export class ApiV1OrganizationNotFoundError extends Schema.TaggedError<ApiV1OrganizationNotFoundError>()(
	"ApiV1OrganizationNotFoundError",
	{
		organizationId: OrganizationId,
		message: Schema.String,
	},
	{ httpApiStatus: 404 },
) {}

// ============ API GROUP ============

export class IntegrationsApiGroup extends HttpApiGroup.make("api-v1-integrations")
	.add(
		HttpApiEndpoint.get("listOrganizations", "/organizations", {
			success: ApiV1OrganizationsListResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "List Organizations",
					description:
						"List the organizations the OAuth user is a member of. Used by integrations to render a workspace picker.",
					summary: "List organizations",
				}),
			),
	)
	.add(
		HttpApiEndpoint.get("listChannels", "/organizations/:organizationId/channels", {
			params: { organizationId: OrganizationId },
			success: ApiV1ChannelsListResponse,
			error: [
				UnauthorizedError,
				ApiV1OrganizationNotFoundError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "List Channels",
					description: "List the channels in an organization the OAuth user is a member of.",
					summary: "List channels",
				}),
			),
	)
	.add(
		HttpApiEndpoint.post("createChannelWebhook", "/channel-webhooks", {
			payload: ApiV1CreateChannelWebhookRequest,
			success: ApiV1ChannelWebhookCreatedResponse,
			error: [
				UnauthorizedError,
				ApiV1ChannelNotFoundError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Create Channel Webhook",
					description:
						"Provision an inbound webhook bound to a channel. Returns a `webhookUrl` integrations should POST to for delivery (uses the same path as the manual webhook flow).",
					summary: "Create channel webhook",
				}),
			),
	)
	.prefix("/api/v1") {}
