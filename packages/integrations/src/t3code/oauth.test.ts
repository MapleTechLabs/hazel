import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { normalizeEnvironmentUrl, pkceChallenge, T3CodeOAuthClient } from "./oauth"

const normalize = (raw: string, allowLoopbackHttp = false) =>
	Effect.runSync(Effect.exit(normalizeEnvironmentUrl(raw, { allowLoopbackHttp })))

/** A client answering each URL with the JSON in `routes`, 404 otherwise. */
const fakeT3 = (routes: Record<string, unknown>) =>
	T3CodeOAuthClient.layer.pipe(
		Layer.provide(
			Layer.succeed(
				HttpClient.HttpClient,
				HttpClient.make((request) =>
					Effect.succeed(
						HttpClientResponse.fromWeb(
							request,
							request.url in routes
								? Response.json(routes[request.url])
								: new Response("not found", { status: 404 }),
						),
					),
				),
			),
		),
	)

describe("normalizeEnvironmentUrl", () => {
	it("takes the environment address or its MCP URL", () => {
		expect(normalize("https://mac.t3.example/mcp")).toEqual(Exit.succeed("https://mac.t3.example"))
		expect(normalize("mac.t3.example/")).toEqual(Exit.succeed("https://mac.t3.example"))
		expect(normalize("  https://mac.t3.example:8443  ")).toEqual(
			Exit.succeed("https://mac.t3.example:8443"),
		)
	})

	it("refuses plain http, credentials and other paths", () => {
		for (const raw of [
			"http://mac.t3.example",
			"http://localhost:3773",
			"https://user:pw@mac.t3.example",
			"https://mac.t3.example/api",
			"ftp://mac.t3.example",
			"not a url at all",
		]) {
			expect(Exit.isFailure(normalize(raw))).toBe(true)
		}
	})

	it("allows http on loopback only in local dev", () => {
		expect(normalize("http://localhost:3773/mcp", true)).toEqual(Exit.succeed("http://localhost:3773"))
		expect(Exit.isFailure(normalize("http://10.0.0.5:3773", true))).toBe(true)
	})
})

describe("T3CodeOAuthClient", () => {
	const origin = "https://mac.t3.example"
	const server = {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/mcp/authorize`,
		token_endpoint: `${origin}/oauth/mcp/token`,
		registration_endpoint: `${origin}/oauth/mcp/register`,
	}

	it.effect("reads the environment's OAuth endpoints", () =>
		Effect.gen(function* () {
			const oauth = yield* T3CodeOAuthClient
			expect(yield* oauth.authorizationServer(origin)).toEqual(server)
		}).pipe(Effect.provide(fakeT3({ [`${origin}/.well-known/oauth-authorization-server`]: server }))),
	)

	it.effect("refuses endpoints on another origin", () =>
		Effect.gen(function* () {
			const oauth = yield* T3CodeOAuthClient
			const exit = yield* Effect.exit(oauth.authorizationServer(origin))
			expect(Exit.isFailure(exit)).toBe(true)
		}).pipe(
			Effect.provide(
				fakeT3({
					[`${origin}/.well-known/oauth-authorization-server`]: {
						...server,
						token_endpoint: "https://evil.example/token",
					},
				}),
			),
		),
	)

	it.effect("fails readably when the address is not a T3 Code environment", () =>
		Effect.gen(function* () {
			const oauth = yield* T3CodeOAuthClient
			const exit = yield* Effect.exit(oauth.environmentInfo(origin))
			expect(exit).toMatchObject({ _tag: "Failure" })
			expect(String(Exit.isFailure(exit) && exit.cause)).toContain("environmentInfo failed (404)")
		}).pipe(Effect.provide(fakeT3({}))),
	)

	it.effect("builds the sign-in URL with PKCE and the MCP resource", () =>
		Effect.gen(function* () {
			const oauth = yield* T3CodeOAuthClient
			const challenge = yield* pkceChallenge("a".repeat(64))
			expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
			const url = oauth.authorizationUrl(server, {
				clientId: "client",
				redirectUri: "https://api.hazel.sh/integrations/t3code/callback",
				state: "state",
				codeChallenge: challenge,
				resource: `${origin}/mcp`,
			})
			expect(url.origin + url.pathname).toBe(server.authorization_endpoint)
			expect(Object.fromEntries(url.searchParams)).toMatchObject({
				response_type: "code",
				client_id: "client",
				code_challenge_method: "S256",
				code_challenge: challenge,
				resource: `${origin}/mcp`,
				state: "state",
			})
		}).pipe(Effect.provide(fakeT3({}))),
	)
})
