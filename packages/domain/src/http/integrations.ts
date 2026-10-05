import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { OrganizationId } from "@hazel/schema"
import { IntegrationConnection } from "../models"
import { RequiredScopes } from "../scopes/required-scopes"

// Provider type from the model
const IntegrationProvider = IntegrationConnection.IntegrationProvider
const ConnectionLevel = IntegrationConnection.ConnectionLevel

// OAuth URL response - returned from getOAuthUrl endpoint for SPA OAuth flow
export class OAuthUrlResponse extends Schema.Class<OAuthUrlResponse>("OAuthUrlResponse")({
	authorizationUrl: Schema.String,
}) {}

export class ConnectionStatusResponse extends Schema.Class<ConnectionStatusResponse>(
	"ConnectionStatusResponse",
)({
	connected: Schema.Boolean,
	provider: IntegrationProvider,
	externalAccountName: Schema.NullOr(Schema.String),
	status: Schema.NullOr(IntegrationConnection.ConnectionStatus),
	connectedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
	lastUsedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}) {}

// Error types
export class IntegrationNotConnectedError extends Schema.TaggedError<IntegrationNotConnectedError>()(
	"IntegrationNotConnectedError",
	{
		provider: IntegrationProvider,
	},
) {}

export class InvalidOAuthStateError extends Schema.TaggedError<InvalidOAuthStateError>()(
	"InvalidOAuthStateError",
	{
		message: Schema.String,
	},
) {}

export class UnsupportedProviderError extends Schema.TaggedError<UnsupportedProviderError>()(
	"UnsupportedProviderError",
	{
		provider: Schema.String,
	},
) {}

export class InvalidApiKeyError extends Schema.TaggedError<InvalidApiKeyError>()("InvalidApiKeyError", {
	message: Schema.String,
}) {}

export class ConnectApiKeyRequest extends Schema.Class<ConnectApiKeyRequest>("ConnectApiKeyRequest")({
	token: Schema.String,
	baseUrl: Schema.String,
}) {}

export class ConnectApiKeyResponse extends Schema.Class<ConnectApiKeyResponse>("ConnectApiKeyResponse")({
	connected: Schema.Boolean,
	provider: IntegrationProvider,
	externalAccountName: Schema.NullOr(Schema.String),
}) {}

export class IntegrationGroup extends HttpApiGroup.make("integrations")
	// Initiate OAuth flow - returns authorization URL for SPA redirect
	.add(
		HttpApiEndpoint.get("getOAuthUrl", `/:orgId/:provider/oauth`, {
			params: {
				orgId: OrganizationId,
				provider: IntegrationProvider,
			},
			query: {
				level: Schema.optional(ConnectionLevel),
			},
			success: OAuthUrlResponse,
			error: [UnsupportedProviderError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Get OAuth Authorization URL",
					description:
						"Returns the OAuth authorization URL for the provider. The frontend should redirect the user to this URL. Sets a session cookie to preserve context for the callback.",
					summary: "Get OAuth URL",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	// OAuth callback handler
	.add(
		HttpApiEndpoint.get("oauthCallback", `/:provider/callback`, {
			params: { provider: IntegrationProvider },
			query: {
				// Standard OAuth uses `code`
				code: Schema.optional(Schema.String),
				// State is optional because GitHub doesn't send it for update callbacks
				state: Schema.optional(Schema.String),
				// Discord bot scope callback includes selected guild context
				guild_id: Schema.optional(Schema.String),
				permissions: Schema.optional(Schema.String),
				// GitHub App uses `installation_id` instead of code
				installation_id: Schema.optional(Schema.String),
				// GitHub also sends setup_action (e.g., "install", "update")
				setup_action: Schema.optional(Schema.String),
			},
			success: Schema.Void.pipe(HttpApiSchema.status(302)),
			error: [InvalidOAuthStateError, UnsupportedProviderError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "OAuth Callback",
					description: "Handle OAuth callback from integration provider",
					summary: "Process OAuth callback",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	// Get connection status
	.add(
		HttpApiEndpoint.get("getConnectionStatus", `/:orgId/:provider/status`, {
			params: {
				orgId: OrganizationId,
				provider: IntegrationProvider,
			},
			query: {
				level: Schema.optional(ConnectionLevel),
			},
			success: ConnectionStatusResponse,
			error: [UnsupportedProviderError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Connection Status",
					description: "Check the connection status for a provider",
					summary: "Get integration status",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	// Connect via API key (non-OAuth providers like Craft)
	.add(
		HttpApiEndpoint.post("connectApiKey", `/:orgId/:provider/api-key`, {
			params: {
				orgId: OrganizationId,
				provider: IntegrationProvider,
			},
			payload: ConnectApiKeyRequest,
			success: ConnectApiKeyResponse,
			error: [InvalidApiKeyError, UnsupportedProviderError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Connect via API Key",
					description:
						"Connect an integration using an API key/token instead of OAuth. Validates the credentials against the provider and stores the connection.",
					summary: "Connect with API key",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	// Disconnect integration
	.add(
		HttpApiEndpoint.delete("disconnect", `/:orgId/:provider`, {
			params: {
				orgId: OrganizationId,
				provider: IntegrationProvider,
			},
			query: {
				level: Schema.optional(ConnectionLevel),
			},
			success: Schema.Void,
			error: [
				IntegrationNotConnectedError,
				UnsupportedProviderError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Disconnect Integration",
					description: "Disconnect an integration and revoke tokens",
					summary: "Disconnect provider",
				}),
			)
			.middleware(CurrentUser.Authorization)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.prefix("/integrations") {}
