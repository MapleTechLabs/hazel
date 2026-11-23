import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import { type AuthProviders, authProviders, SignInProvider } from "./contract.ts"
import { devSignInGitHubClient, type HazelAuthConfig } from "./server.ts"

/**
 * The sign-in methods `config` offers: its configured OAuth apps, in the contract's order (never
 * the dev sign-in's stand-in GitHub app), and passkeys.
 */
export const enabledProviders = (config: HazelAuthConfig): AuthProviders => ({
	providers: SignInProvider.literals.filter((provider) => {
		const client = config[provider]
		return client !== undefined && client.clientId !== devSignInGitHubClient.clientId
	}),
	passkeys: true,
})

/**
 * `GET /auth/providers`: what the sign-in page may offer. Public and the same for everyone, so
 * the browser may cache it briefly.
 */
export const makeProvidersRoute = (config: HazelAuthConfig) => {
	const body = enabledProviders(config)
	return HttpRouter.add(
		"GET",
		authProviders.path,
		HttpServerResponse.json(body).pipe(
			Effect.map(HttpServerResponse.setHeader("cache-control", "public, max-age=60")),
		),
	)
}
