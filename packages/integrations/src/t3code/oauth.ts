/**
 * Linking a T3 Code environment: its MCP OAuth server (RFC 8414 metadata, RFC 7591 dynamic
 * registration, authorization code with PKCE S256). T3 issues no refresh tokens; a credential
 * lasts 30 days and the member signs in again after it. See T3 Code's `docs/user/outside-agents.md`.
 */
import {
	FetchHttpClient,
	HttpBody,
	HttpClient,
	type HttpClientError,
	type HttpClientResponse,
} from "effect/http"
import { Context, Duration, Effect, Layer, Schema } from "effect"

const TIMEOUT = Duration.seconds(15)

/** The environment did not answer as a T3 Code environment, or refused a step. */
export class T3CodeOAuthError extends Schema.TaggedError<T3CodeOAuthError>()("T3CodeOAuthError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

const isIpLiteral = (hostname: string) => hostname.startsWith("[") || /^[\d.]+$/.test(hostname)

/**
 * The environment's origin from what a member pastes: its address or its MCP URL. Only `https` to
 * a public host name, plus loopback when `allowLoopbackHttp` (local dev), with no credentials.
 */
export const normalizeEnvironmentUrl = (raw: string, options: { readonly allowLoopbackHttp: boolean }) =>
	Effect.gen(function* () {
		const invalid = (message: string) => Effect.fail(new T3CodeOAuthError({ message }))
		const trimmed = raw.trim()
		const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
		const url = yield* Effect.try({
			try: () => new URL(withScheme),
			catch: () => new T3CodeOAuthError({ message: "That is not a valid URL." }),
		})
		if (url.username !== "" || url.password !== "") {
			return yield* invalid("The URL must not contain credentials.")
		}
		const loopback = LOOPBACK_HOSTNAMES.has(url.hostname)
		if (loopback && options.allowLoopbackHttp) {
			if (url.protocol !== "https:" && url.protocol !== "http:")
				return yield* invalid("Use an http(s) URL.")
		} else if (
			url.protocol !== "https:" ||
			// The backend fetches it: a public host name only, never an IP or an internal name.
			isIpLiteral(url.hostname) ||
			!url.hostname.includes(".")
		) {
			return yield* invalid("Use the environment's https address, such as its T3 Connect address.")
		}
		const path = url.pathname.replace(/\/+$/, "")
		if (path !== "" && path !== "/mcp") {
			return yield* invalid("Paste the environment's address or its MCP URL (ending in /mcp).")
		}
		return url.origin
	})

export const T3CodeEnvironmentInfo = Schema.Struct({
	environmentId: Schema.String,
	label: Schema.String,
	serverVersion: Schema.optional(Schema.String),
})
export type T3CodeEnvironmentInfo = typeof T3CodeEnvironmentInfo.Type

export const T3CodeAuthorizationServer = Schema.Struct({
	issuer: Schema.String,
	authorization_endpoint: Schema.String,
	token_endpoint: Schema.String,
	registration_endpoint: Schema.String,
})
export type T3CodeAuthorizationServer = typeof T3CodeAuthorizationServer.Type

const RegisteredClient = Schema.Struct({ client_id: Schema.String })

const TokenResponse = Schema.Struct({
	access_token: Schema.String,
	token_type: Schema.optional(Schema.String),
	expires_in: Schema.optional(Schema.Number),
	scope: Schema.optional(Schema.String),
})

export interface T3CodeTokens {
	readonly accessToken: string
	readonly expiresAt: Date | null
	readonly scope: string | null
}

const base64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "")

/** A random URL-safe string of `bytes` bytes (PKCE verifier, state). */
export const randomToken = (bytes = 32) => base64Url(crypto.getRandomValues(new Uint8Array(bytes)))

/** The S256 challenge of a PKCE verifier. */
export const pkceChallenge = (verifier: string) =>
	Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).pipe(
		Effect.map((digest) => base64Url(new Uint8Array(digest))),
	)

export class T3CodeOAuthClient extends Context.Service<T3CodeOAuthClient>()("T3CodeOAuthClient", {
	make: Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient

		const send = <A>(
			step: string,
			request: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
			schema: Schema.Codec<A, unknown>,
		): Effect.Effect<A, T3CodeOAuthError> =>
			Effect.gen(function* () {
				// Never follow a redirect: every endpoint must be the environment's own.
				const response = yield* Effect.timeout(request, TIMEOUT).pipe(
					Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
				)
				if (response.status >= 300) {
					// The body stays in the cause (logs), never in the message a member sees.
					const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
					return yield* new T3CodeOAuthError({
						message:
							response.status < 400
								? `${step}: the environment redirected elsewhere`
								: `${step} failed (${response.status})`,
						status: response.status,
						cause: body.slice(0, 500),
					})
				}
				return yield* Schema.decodeUnknownEffect(schema)(yield* response.json)
			}).pipe(
				Effect.catchTags({
					TimeoutError: (cause: unknown) =>
						Effect.fail(new T3CodeOAuthError({ message: `${step} timed out`, cause })),
					HttpClientError: (cause: unknown) =>
						Effect.fail(
							new T3CodeOAuthError({
								message: `${step}: the environment is unreachable`,
								cause,
							}),
						),
					SchemaError: (cause: unknown) =>
						Effect.fail(
							new T3CodeOAuthError({ message: `${step}: not a T3 Code environment`, cause }),
						),
				}),
				Effect.withSpan(`T3CodeOAuthClient.${step}`),
			)

		const postJson = (url: string, body: unknown) =>
			http.post(url, {
				body: HttpBody.text(JSON.stringify(body), "application/json"),
				headers: { accept: "application/json" },
			})

		/** The environment's label and id (`/.well-known/t3/environment`). */
		const environmentInfo = (origin: string) =>
			send("environmentInfo", http.get(`${origin}/.well-known/t3/environment`), T3CodeEnvironmentInfo)

		/** The MCP OAuth endpoints (`/.well-known/oauth-authorization-server`). */
		const authorizationServer = (origin: string) =>
			send(
				"authorizationServer",
				http.get(`${origin}/.well-known/oauth-authorization-server`),
				T3CodeAuthorizationServer,
			).pipe(
				Effect.filterOrFail(
					// The endpoints must live on the environment itself, never elsewhere.
					(server) =>
						[
							server.authorization_endpoint,
							server.token_endpoint,
							server.registration_endpoint,
						].every((endpoint) => URL.canParse(endpoint) && new URL(endpoint).origin === origin),
					() =>
						new T3CodeOAuthError({
							message: "The environment's OAuth endpoints are on another origin.",
						}),
				),
			)

		/** Register Hazel as a public client; T3 signs the client id, so registering again is harmless. */
		const register = (server: T3CodeAuthorizationServer, input: { readonly redirectUri: string }) =>
			send(
				"register",
				postJson(server.registration_endpoint, {
					client_name: "Hazel",
					redirect_uris: [input.redirectUri],
					grant_types: ["authorization_code"],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
				}),
				RegisteredClient,
			).pipe(Effect.map((client) => client.client_id))

		/** The sign-in page to send the member to. */
		const authorizationUrl = (
			server: T3CodeAuthorizationServer,
			input: {
				readonly clientId: string
				readonly redirectUri: string
				readonly state: string
				readonly codeChallenge: string
				readonly resource: string
			},
		) => {
			const url = new URL(server.authorization_endpoint)
			url.searchParams.set("response_type", "code")
			url.searchParams.set("client_id", input.clientId)
			url.searchParams.set("redirect_uri", input.redirectUri)
			url.searchParams.set("state", input.state)
			url.searchParams.set("code_challenge", input.codeChallenge)
			url.searchParams.set("code_challenge_method", "S256")
			url.searchParams.set("resource", input.resource)
			url.searchParams.set("scope", "orchestration:read orchestration:operate")
			return url
		}

		const exchangeCode = (input: {
			readonly tokenEndpoint: string
			readonly clientId: string
			readonly redirectUri: string
			readonly code: string
			readonly codeVerifier: string
			readonly resource: string
		}) =>
			send(
				"exchangeCode",
				http.post(input.tokenEndpoint, {
					body: HttpBody.urlParams(
						new URLSearchParams({
							grant_type: "authorization_code",
							code: input.code,
							redirect_uri: input.redirectUri,
							client_id: input.clientId,
							code_verifier: input.codeVerifier,
							resource: input.resource,
						}),
					),
					headers: { accept: "application/json" },
				}),
				TokenResponse,
			).pipe(
				Effect.map(
					(token): T3CodeTokens => ({
						accessToken: token.access_token,
						expiresAt:
							token.expires_in === undefined
								? null
								: new Date(Date.now() + token.expires_in * 1000),
						scope: token.scope ?? null,
					}),
				),
			)

		return { environmentInfo, authorizationServer, register, authorizationUrl, exchangeCode }
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
