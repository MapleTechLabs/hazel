import { Effect, Schema } from "effect"
import { OAuthHttpClient } from "./oauth-http-client"
import type {
	AppProviderConfig,
	IntegrationProvider,
	OAuthAccountInfo,
	OAuthProviderConfig,
	OAuthTokens,
} from "./provider-config"

const IntegrationProviderSchema = Schema.Literals(["linear", "github", "figma", "notion", "discord", "craft"])

/**
 * Error when exchanging authorization code for tokens fails.
 */
export class TokenExchangeError extends Schema.TaggedError<TokenExchangeError>()("TokenExchangeError", {
	provider: IntegrationProviderSchema,
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when fetching account info from provider fails.
 */
export class AccountInfoError extends Schema.TaggedError<AccountInfoError>()("AccountInfoError", {
	provider: IntegrationProviderSchema,
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when refreshing access token fails.
 */
export class TokenRefreshError extends Schema.TaggedError<TokenRefreshError>()("TokenRefreshError", {
	provider: IntegrationProviderSchema,
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when provider is not supported or not configured.
 */
export class ProviderNotConfiguredError extends Schema.TaggedError<ProviderNotConfiguredError>()(
	"ProviderNotConfiguredError",
	{
		provider: IntegrationProviderSchema,
		message: Schema.String,
	},
) {}

/**
 * Interface for OAuth providers.
 *
 * Each integration provider (Linear, GitHub, Figma, Notion) implements this interface
 * to handle their specific OAuth flow details while maintaining a consistent API.
 *
 * ## Usage Example
 *
 * ```typescript
 * const registry = yield* OAuthProviderRegistry
 * const provider = yield* registry.getProvider("linear")
 *
 * // Get authorization URL
 * const authUrl = yield* provider.buildAuthorizationUrl(state)
 *
 * // After callback, exchange code for tokens
 * const tokens = yield* provider.exchangeCodeForTokens(code)
 *
 * // Get account info
 * const accountInfo = yield* provider.getAccountInfo(tokens.accessToken)
 * ```
 */
export interface OAuthProvider {
	/**
	 * The provider identifier (e.g., "linear", "github").
	 */
	readonly provider: IntegrationProvider

	/**
	 * The provider's configuration.
	 * Standard OAuth providers have full config; app-based providers (e.g., GitHub App)
	 * have minimal config as they manage their own authentication.
	 */
	readonly config: OAuthProviderConfig | AppProviderConfig

	/**
	 * Build the OAuth authorization URL for redirecting the user.
	 *
	 * @param state - Encoded state containing organizationId, userId, etc.
	 * @returns Full authorization URL with all required parameters.
	 */
	buildAuthorizationUrl(state: string): Effect.Effect<URL, never>

	/**
	 * Exchange an authorization code for access and refresh tokens.
	 *
	 * @param code - The authorization code from the OAuth callback.
	 * @returns OAuth tokens including access token and optional refresh token.
	 */
	exchangeCodeForTokens(code: string): Effect.Effect<OAuthTokens, TokenExchangeError>

	/**
	 * Fetch account information from the provider's API.
	 *
	 * @param accessToken - Valid access token for API authentication.
	 * @returns Account info with external ID and display name.
	 */
	getAccountInfo(accessToken: string): Effect.Effect<OAuthAccountInfo, AccountInfoError>

	/**
	 * Refresh an expired access token using a refresh token.
	 * Not all providers support refresh tokens.
	 *
	 * @param refreshToken - The refresh token from initial authorization.
	 * @returns New OAuth tokens.
	 */
	refreshAccessToken?(refreshToken: string): Effect.Effect<OAuthTokens, TokenRefreshError>
}

/**
 * Base implementation helper for OAuth providers.
 * Provides common functionality like authorization URL building.
 */
export const createBaseAuthorizationUrl = (config: OAuthProviderConfig, state: string): URL => {
	const url = new URL(config.authorizationUrl)
	url.searchParams.set("client_id", config.clientId)
	url.searchParams.set("redirect_uri", config.redirectUri)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("state", state)

	if (config.scopes.length > 0) {
		url.searchParams.set("scope", config.scopes.join(config.scopeDelimiter))
	}

	if (config.additionalAuthParams) {
		for (const [key, value] of Object.entries(config.additionalAuthParams)) {
			url.searchParams.set(key, value)
		}
	}

	return url
}

/**
 * Helper to make a standard OAuth token exchange request.
 * Uses Effect HttpClient for type-safe HTTP operations.
 */
export const makeTokenExchangeRequest = (
	config: OAuthProviderConfig,
	code: string,
	clientSecret: string,
): Effect.Effect<OAuthTokens, TokenExchangeError> =>
	Effect.gen(function* () {
		const oauthClient = yield* OAuthHttpClient
		const result = yield* oauthClient.exchangeCode(config.tokenUrl, {
			code,
			redirectUri: config.redirectUri,
			clientId: config.clientId,
			clientSecret,
		})

		return {
			accessToken: result.accessToken,
			refreshToken: result.refreshToken,
			expiresAt: result.expiresAt,
			scope: result.scope,
			tokenType: result.tokenType,
		} satisfies OAuthTokens
	}).pipe(
		Effect.provide(OAuthHttpClient.layer),
		Effect.mapError(
			(error) =>
				new TokenExchangeError({
					provider: config.provider,
					message: `Failed to exchange code for tokens: ${"message" in error ? error.message : String(error)}`,
					cause: error,
				}),
		),
	)
