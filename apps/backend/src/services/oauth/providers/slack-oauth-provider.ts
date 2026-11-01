import { Slack } from "@hazel/integrations"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import {
	AccountInfoError,
	createBaseAuthorizationUrl,
	type OAuthProvider,
	TokenExchangeError,
} from "../oauth-provider"
import type { OAuthProviderConfig } from "../provider-config"

const SlackApi = Slack.SlackApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer))

/** What a user linking their own Slack account grants: their identity, nothing more. */
const USER_SCOPES = "users:read"

/**
 * Slack OAuth v2 (`oauth.v2.access`). The organization installs Hazel's bot in its workspace (bot
 * `scope`); its connection's account is the workspace (team), and the bot token is the one
 * chat sync posts with. A user links their own Slack account with `user_scope` only, and their
 * connection's account is their Slack user. Slack answers errors with `ok: false` on HTTP 200,
 * so the exchange is Slack's own, not the shared form post.
 *
 * @see https://docs.slack.dev/authentication/installing-with-oauth
 */
export const createSlackOAuthProvider = (config: OAuthProviderConfig): OAuthProvider => ({
	provider: "slack",
	config,

	buildAuthorizationUrl: (state, level) =>
		Effect.sync(() => {
			const url = createBaseAuthorizationUrl(config, state)
			if (level === "user") {
				url.searchParams.delete("scope")
				url.searchParams.set("user_scope", USER_SCOPES)
			}
			return url
		}),

	exchangeCodeForTokens: (code) =>
		Effect.gen(function* () {
			const api = yield* Slack.SlackApiClient
			const access = yield* api.oauthAccess({
				code,
				clientId: config.clientId,
				clientSecret: Redacted.value(config.clientSecret),
				redirectUri: config.redirectUri,
			})
			// A bot install answers with the bot token; a user link only with the user's.
			const accessToken = access.accessToken ?? access.authedUser.accessToken
			if (accessToken === null) {
				return yield* new TokenExchangeError({
					provider: "slack",
					message: "Slack returned no token",
				})
			}
			return {
				accessToken,
				scope: (access.accessToken !== null ? access.scope : access.authedUser.scope) ?? undefined,
				tokenType: access.accessToken !== null ? "bot" : "user",
			}
		}).pipe(
			Effect.provide(SlackApi),
			Effect.catchTag("SlackApiError", (error) =>
				Effect.fail(
					new TokenExchangeError({
						provider: "slack",
						message: `Slack refused the code: ${error.message}`,
						cause: error,
					}),
				),
			),
		),

	getAccountInfo: (accessToken) =>
		Effect.gen(function* () {
			const api = yield* Slack.SlackApiClient
			const identity = yield* api.authTest(accessToken)
			// The bot token names the workspace; a user token the user.
			return identity.botId !== null
				? { externalAccountId: identity.teamId, externalAccountName: identity.team }
				: { externalAccountId: identity.userId, externalAccountName: identity.team }
		}).pipe(
			Effect.provide(SlackApi),
			Effect.catchTag("SlackApiError", (error) =>
				Effect.fail(
					new AccountInfoError({
						provider: "slack",
						message: `Failed to get Slack account info: ${error.message}`,
						cause: error,
					}),
				),
			),
		),
})
