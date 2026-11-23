/**
 * An install with only some OAuth apps: the routes exist for those alone, and `/auth/providers`
 * tells the sign-in page which ones to show. Google's discovery document is simulated.
 */
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { layerMemory } from "@hazel/db/node"
import { Hooks } from "@yielded/auth"
import { Context, Effect, Layer, Redacted } from "effect"
import { Base64Url } from "effect/encoding"
import { Etag, HttpClient, HttpClientResponse, HttpRouter } from "effect/http"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { authProviders } from "./contract.ts"
import { enabledProviders, makeProvidersRoute } from "./providers.ts"
import { devSignInGitHubClient, type HazelAuthConfig, makeHazelAuthLive } from "./server.ts"

const origin = "http://localhost:3003"
const webOrigin = "http://localhost:3000"
const client = (id: string) => ({ clientId: id, clientSecret: Redacted.make("test-secret") })

const keyring = (byte: number) => ({
	activeKeyId: "v1",
	keys: [{ id: "v1", material: Redacted.make(Base64Url.encode(new Uint8Array(32).fill(byte))) }],
})

const base = {
	origin,
	appOrigin: webOrigin,
	trustedOrigins: [webOrigin],
	passkey: { rpId: "localhost", origins: [webOrigin] },
	keys: { binding: keyring(1), transaction: keyring(2) },
	returnTargets: ["/"],
	registrationPath: "/auth/register",
	continuePath: "/auth/continue",
} satisfies Omit<HazelAuthConfig, "github" | "google">

const FakeGoogle = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) =>
		Effect.sync(() =>
			url.href === "https://accounts.google.com/.well-known/openid-configuration"
				? HttpClientResponse.fromWeb(
						request,
						new Response(
							JSON.stringify({
								issuer: "https://accounts.google.com",
								authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
								token_endpoint: "https://oauth2.googleapis.com/token",
								jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
								response_types_supported: ["code"],
								subject_types_supported: ["public"],
								id_token_signing_alg_values_supported: ["RS256"],
								code_challenge_methods_supported: ["S256"],
								token_endpoint_auth_methods_supported: [
									"client_secret_post",
									"client_secret_basic",
								],
								authorization_response_iss_parameter_supported: true,
							}),
							{ headers: { "content-type": "application/json" } },
						),
					)
				: HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })),
		),
	),
)

describe("enabledProviders", () => {
	test("lists the configured OAuth apps in the contract's order, with passkeys", () => {
		expect(enabledProviders({ ...base, github: client("gh") })).toEqual({
			providers: ["github"],
			passkeys: true,
		})
		expect(enabledProviders({ ...base, google: client("g") })).toEqual({
			providers: ["google"],
			passkeys: true,
		})
		expect(enabledProviders({ ...base, google: client("g"), github: client("gh") })).toEqual({
			providers: ["github", "google"],
			passkeys: true,
		})
	})

	test("never offers the dev sign-in's stand-in GitHub app", () => {
		expect(enabledProviders({ ...base, github: devSignInGitHubClient }).providers).toEqual([])
	})
})

describe("a Google-only install", () => {
	const config = { ...base, google: client("google.test") } satisfies HazelAuthConfig
	const { http, Services } = makeHazelAuthLive(config)
	const App = Layer.mergeAll(http.routes(), makeProvidersRoute(config)).pipe(
		Layer.provide(http.layer),
		Layer.provideMerge(Services),
		Layer.provide(FakeGoogle),
		Layer.provide(Hooks.LifecycleHooks.empty),
		Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layer]),
		Layer.provide(layerMemory),
	)

	let web: ReturnType<typeof HttpRouter.toWebHandler>
	beforeAll(() => {
		web = HttpRouter.toWebHandler(App, { disableLogger: true })
	})
	afterAll(async () => {
		await web?.dispose()
	})

	const send = (request: Request) =>
		(web.handler as (request: Request, context: Context.Context<never>) => Promise<Response>)(
			request,
			Context.empty() as Context.Context<never>,
		)
	const signIn = (provider: string) =>
		send(
			new Request(`${origin}/auth/signIn`, {
				method: "POST",
				headers: {
					origin: webOrigin,
					"content-type": "application/json",
					"x-effect-auth-csrf": "1",
				},
				body: JSON.stringify({ payload: { provider, returnTarget: "/" } }),
			}),
		)

	test("answers /auth/providers with Google alone", async () => {
		const response = await send(new Request(`${origin}${authProviders.path}`))
		expect(response.status).toBe(200)
		expect(response.headers.get("cache-control")).toBe("public, max-age=60")
		expect(await response.json()).toEqual({ providers: ["google"], passkeys: true })
	})

	test("starts a Google sign-in", async () => {
		const response = await signIn("google")
		expect(response.status).toBe(200)
		const url = new URL((await response.json()).value.authorizationUrl)
		expect(url.origin).toBe("https://accounts.google.com")
		expect(url.searchParams.get("client_id")).toBe("google.test")
	})

	test("refuses a GitHub sign-in, and has no GitHub callback", async () => {
		const response = await signIn("github")
		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ _tag: "Failure", error: { _tag: "OAuthRejected" } })
		const callback = await send(new Request(`${origin}/auth/github/callback?code=c&state=s`))
		expect(callback.status).toBe(404)
	})
})
