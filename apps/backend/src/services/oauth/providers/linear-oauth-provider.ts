import { Linear } from "@hazel/integrations"
import { Effect, Redacted } from "effect"
import {
	AccountInfoError,
	createBaseAuthorizationUrl,
	makeTokenExchangeRequest,
	type OAuthProvider,
} from "../oauth-provider"
import type { OAuthProviderConfig } from "../provider-config"

/**
 * Linear OAuth Provider Implementation.
 *
 * Linear uses OAuth 2.0 with the following specifics:
 * - Authorization URL: https://linear.app/oauth/authorize
 * - Token URL: https://api.linear.app/oauth/token
 * - User Info: GraphQL API at https://api.linear.app/graphql
 * - Scopes: read, write (comma-separated)
 * - No refresh tokens (tokens are long-lived)
 *
 * @see https://developers.linear.app/docs/oauth/authentication
 */
export const createLinearOAuthProvider = (config: OAuthProviderConfig): OAuthProvider => ({
	provider: "linear",
	config,

	buildAuthorizationUrl: (state: string) => Effect.succeed(createBaseAuthorizationUrl(config, state)),

	exchangeCodeForTokens: (code: string) =>
		makeTokenExchangeRequest(config, code, Redacted.value(config.clientSecret)),

	getAccountInfo: (accessToken: string) =>
		Effect.gen(function* () {
			const client = yield* Linear.LinearApiClient
			return yield* client.getAccountInfo(accessToken)
		}).pipe(
			Effect.provide(Linear.LinearApiClient.layer),
			Effect.mapError(
				(error) =>
					new AccountInfoError({
						provider: "linear",
						message: `Failed to get Linear account info: ${"message" in error ? error.message : String(error)}`,
						cause: error,
					}),
			),
		),

	// Linear doesn't use refresh tokens - access tokens are long-lived
	// refreshAccessToken is intentionally not implemented
})
