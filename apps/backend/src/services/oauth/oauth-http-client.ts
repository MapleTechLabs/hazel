/**
 * OAuth HTTP Client
 *
 * Effect-based HTTP client for OAuth token operations (exchange and refresh).
 * Uses HttpClient with proper schema validation and error handling.
 */

import { FetchHttpClient, HttpBody, HttpClient } from "effect/http"
import { Context, Duration, Effect, Layer, Predicate, Schema, SchemaGetter, SchemaIssue } from "effect"
import type { OAuthIntegrationProvider } from "./provider-config"

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT = Duration.seconds(30)

// ============================================================================
// Response Schemas
// ============================================================================

const OAuthTokenApiResponse = Schema.Struct({
	access_token: Schema.String,
	refresh_token: Schema.optionalKey(Schema.String),
	expires_in: Schema.optionalKey(Schema.Number),
	scope: Schema.optionalKey(Schema.String),
	token_type: Schema.optional(Schema.String).pipe(
		Schema.decodeTo(Schema.toType(Schema.String), {
			decode: SchemaGetter.withDefault(Effect.succeed("Bearer")),
			encode: SchemaGetter.required(),
		}),
	),
})

// ============================================================================
// Error Types
// ============================================================================

export class OAuthHttpError extends Schema.TaggedError<OAuthHttpError>()("OAuthHttpError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

// ============================================================================
// Result Types
// ============================================================================

export interface OAuthTokenResult {
	accessToken: string
	refreshToken?: string
	expiresAt?: Date
	scope?: string
	tokenType: string
}

// ============================================================================
// Token URL Map
// ============================================================================

const TOKEN_URLS: Record<OAuthIntegrationProvider, string> = {
	linear: "https://api.linear.app/oauth/token",
	github: "https://github.com/login/oauth/access_token",
	figma: "https://www.figma.com/api/oauth/refresh",
	notion: "https://api.notion.com/v1/oauth/token",
	discord: "https://discord.com/api/oauth2/token",
}

// ============================================================================
// Helper to encode form data
// ============================================================================

const encodeFormData = (params: Record<string, string>): string =>
	Object.entries(params)
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join("&")

// ============================================================================
// OAuthHttpClient Service
// ============================================================================

/**
 * OAuth HTTP Client Service.
 *
 * Provides Effect-based HTTP methods for OAuth token operations using HttpClient
 * with proper schema validation and error handling.
 */
export class OAuthHttpClient extends Context.Service<OAuthHttpClient>()("OAuthHttpClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		/**
		 * Exchange authorization code for tokens.
		 */
		const exchangeCode = Effect.fn("OAuthHttpClient.exchangeCode")(function* (
			tokenUrl: string,
			params: {
				code: string
				redirectUri: string
				clientId: string
				clientSecret: string
			},
		) {
			const formData = encodeFormData({
				grant_type: "authorization_code",
				code: params.code,
				redirect_uri: params.redirectUri,
				client_id: params.clientId,
				client_secret: params.clientSecret,
			})

			const response = yield* httpClient
				.post(tokenUrl, {
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Accept: "application/json",
					},
					body: HttpBody.text(formData, "application/x-www-form-urlencoded"),
				})
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				const errorText = yield* response.text
				return yield* Effect.fail(
					new OAuthHttpError({
						message: `Token exchange failed: ${response.status} ${errorText}`,
						status: response.status,
					}),
				)
			}

			const data = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(OAuthTokenApiResponse)),
				Effect.catch((error) =>
					Effect.fail(
						new OAuthHttpError({
							message: `Failed to parse token response: ${String(error)}`,
							cause: error,
						}),
					),
				),
			)

			return {
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
				scope: data.scope,
				tokenType: data.token_type,
			} satisfies OAuthTokenResult
		})

		/**
		 * Refresh expired access token.
		 */
		const refreshToken = Effect.fn("OAuthHttpClient.refreshToken")(function* (
			provider: OAuthIntegrationProvider,
			params: {
				refreshToken: string
				clientId: string
				clientSecret: string
			},
		) {
			const tokenUrl = TOKEN_URLS[provider]

			const formData = encodeFormData({
				grant_type: "refresh_token",
				refresh_token: params.refreshToken,
				client_id: params.clientId,
				client_secret: params.clientSecret,
			})

			const response = yield* httpClient
				.post(tokenUrl, {
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Accept: "application/json",
					},
					body: HttpBody.text(formData, "application/x-www-form-urlencoded"),
				})
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			if (response.status >= 400) {
				const errorText = yield* response.text
				return yield* Effect.fail(
					new OAuthHttpError({
						message: `Token refresh failed: ${response.status} ${errorText}`,
						status: response.status,
					}),
				)
			}

			const data = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(OAuthTokenApiResponse)),
				Effect.catch((error) =>
					Effect.fail(
						new OAuthHttpError({
							message: `Failed to parse token response: ${String(error)}`,
							cause: error,
						}),
					),
				),
			)

			return {
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
				scope: data.scope,
				tokenType: data.token_type,
			} satisfies OAuthTokenResult
		})

		// Apply error handling for network/timeout errors
		const wrappedExchangeCode = (
			tokenUrl: string,
			params: { code: string; redirectUri: string; clientId: string; clientSecret: string },
		) =>
			exchangeCode(tokenUrl, params).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new OAuthHttpError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new OAuthHttpError({
							message: `Network error: ${String(error)}`,
							cause: error,
						}),
					),
				),
				Effect.withSpan("OAuthHttpClient.exchangeCode"),
			)

		const wrappedRefreshToken = (
			provider: OAuthIntegrationProvider,
			params: { refreshToken: string; clientId: string; clientSecret: string },
		) =>
			refreshToken(provider, params).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new OAuthHttpError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new OAuthHttpError({
							message: `Network error: ${String(error)}`,
							cause: error,
						}),
					),
				),
				Effect.withSpan("OAuthHttpClient.refreshToken", { attributes: { provider } }),
			)

		return {
			exchangeCode: wrappedExchangeCode,
			refreshToken: wrappedRefreshToken,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}
