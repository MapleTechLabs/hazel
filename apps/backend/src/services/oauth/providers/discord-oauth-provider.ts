import { Discord } from "@hazel/integrations"
import { Effect, Redacted } from "effect"
import {
	AccountInfoError,
	createBaseAuthorizationUrl,
	makeTokenExchangeRequest,
	type OAuthProvider,
} from "../oauth-provider"
import type { OAuthProviderConfig } from "../provider-config"

export const createDiscordOAuthProvider = (config: OAuthProviderConfig): OAuthProvider => ({
	provider: "discord",
	config,

	buildAuthorizationUrl: (state, level) =>
		Effect.sync(() => {
			const url = createBaseAuthorizationUrl(config, state)
			// Linking a user's account only needs their identity; the org's keeps guild and bot scopes.
			if (level === "user") {
				url.searchParams.set("scope", "identify")
				url.searchParams.delete("permissions")
			}
			return url
		}),

	exchangeCodeForTokens: (code: string) =>
		makeTokenExchangeRequest(config, code, Redacted.value(config.clientSecret)),

	getAccountInfo: (accessToken: string) =>
		Effect.gen(function* () {
			const discordApiClient = yield* Discord.DiscordApiClient
			return yield* discordApiClient.getAccountInfo(accessToken)
		}).pipe(
			Effect.provide(Discord.DiscordApiClient.layer),
			Effect.mapError(
				(error) =>
					new AccountInfoError({
						provider: "discord",
						message: `Failed to get Discord account info: ${error instanceof Error ? error.message : String(error)}`,
						cause: error,
					}),
			),
		),
})
