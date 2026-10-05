import { createPrivateKey } from "node:crypto"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { Context, Config, Effect, Layer, Redacted, Schema } from "effect"
import { SignJWT } from "jose"

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error when JWT generation fails.
 */
export class GitHubAppJWTError extends Schema.TaggedError<GitHubAppJWTError>()("GitHubAppJWTError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when installation token generation fails.
 */
export class GitHubInstallationTokenError extends Schema.TaggedError<GitHubInstallationTokenError>()(
	"GitHubInstallationTokenError",
	{
		installationId: Schema.String,
		message: Schema.String,
		status: Schema.optional(Schema.Number),
		cause: Schema.optional(Schema.Unknown),
	},
) {}

// ============================================================================
// Types
// ============================================================================

/**
 * GitHub App configuration loaded from environment.
 */
export interface GitHubAppConfig {
	readonly appId: string
	readonly appSlug: string
	readonly privateKey: string // PEM format (decoded from base64)
}

/**
 * Installation access token response from GitHub.
 */
export interface InstallationToken {
	readonly token: string
	readonly expiresAt: Date
}

// ============================================================================
// API Response Schemas
// ============================================================================

// GitHub API installation token response schema
const InstallationTokenApiResponse = Schema.Struct({
	token: Schema.String,
	expires_at: Schema.String,
})

// GitHub API error response schema
const GitHubErrorApiResponse = Schema.Struct({
	message: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("Unknown error"))),
})

// ============================================================================
// Configuration
// ============================================================================

/**
 * Load GitHub App configuration from environment variables.
 *
 * Required env vars:
 * - GITHUB_APP_ID: The numeric App ID
 * - GITHUB_APP_SLUG: The app slug (from URL)
 * - GITHUB_APP_PRIVATE_KEY: Base64-encoded PEM private key
 */
export const loadGitHubAppConfig = Effect.withSpan("GitHubAppJWTService.loadConfig")(
	Effect.gen(function* () {
		const appId = yield* Config.String("GITHUB_APP_ID")
		const appSlug = yield* Config.String("GITHUB_APP_SLUG")
		const privateKeyBase64 = yield* Config.Redacted("GITHUB_APP_PRIVATE_KEY")

		// Decode the base64 private key
		const privateKey = Buffer.from(Redacted.value(privateKeyBase64), "base64").toString("utf-8")

		return {
			appId,
			appSlug,
			privateKey,
		} satisfies GitHubAppConfig
	}),
)

// ============================================================================
// JWT Generation
// ============================================================================

/**
 * Generate a JWT for authenticating as the GitHub App.
 *
 * The JWT is used to request installation access tokens.
 * It has a short TTL (10 minutes max per GitHub's requirements).
 *
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export const generateAppJWT = (
	appId: string,
	privateKeyPem: string,
): Effect.Effect<string, GitHubAppJWTError> =>
	Effect.tryPromise({
		try: async () => {
			const now = Math.floor(Date.now() / 1000)

			// Import the private key for signing
			// Use Node's createPrivateKey which handles both PKCS#1 (RSA PRIVATE KEY)
			// and PKCS#8 (PRIVATE KEY) formats - GitHub generates PKCS#1 keys
			const privateKey = createPrivateKey(privateKeyPem)

			// Create and sign the JWT
			const jwt = await new SignJWT({})
				.setProtectedHeader({ alg: "RS256" })
				.setIssuedAt(now - 30) // 30 seconds in the past for clock drift (security hardened)
				.setExpirationTime(now + 600) // 10 minutes from now (max allowed by GitHub)
				.setIssuer(appId)
				.sign(privateKey)

			return jwt
		},
		catch: (error) =>
			new GitHubAppJWTError({
				message: `Failed to generate GitHub App JWT: ${String(error)}`,
				cause: error,
			}),
	})

// ============================================================================
// GitHub App JWT Service
// ============================================================================

const GITHUB_API_BASE_URL = "https://api.github.com"

/**
 * GitHub App JWT Service.
 *
 * Provides methods for generating GitHub App JWTs and installation access tokens.
 *
 * ## Usage
 *
 * ```typescript
 * const jwtService = yield* GitHubAppJWTService
 *
 * // Generate an installation token for making API calls
 * const token = yield* jwtService.getInstallationToken(installationId)
 * // token.token is the access token
 * // token.expiresAt is when it expires (1 hour from now)
 * ```
 */
export class GitHubAppJWTService extends Context.Service<GitHubAppJWTService>()("GitHubAppJWTService", {
	make: Effect.gen(function* () {
		// Load config once at service initialization
		// Use orDie since missing config is a fatal startup error
		const config = yield* loadGitHubAppConfig.pipe(Effect.orDie)
		const httpClient = yield* HttpClient.HttpClient

		/**
		 * Get the app slug for building installation URLs.
		 */
		const getAppSlug = (): string => config.appSlug

		/**
		 * Build the installation URL for redirecting users.
		 */
		const buildInstallationUrl = (state: string): URL => {
			// Use select_target to let users choose which org/account to install on
			const url = new URL(`https://github.com/apps/${config.appSlug}/installations/select_target`)
			url.searchParams.set("state", state)
			return url
		}

		/**
		 * Generate an installation access token using the App JWT.
		 *
		 * This token is used to make API calls on behalf of a specific installation.
		 * Tokens expire after 1 hour.
		 */
		const generateInstallationToken = (
			installationId: string,
			appJwt: string,
		): Effect.Effect<InstallationToken, GitHubInstallationTokenError> =>
			Effect.gen(function* () {
				const url = `${GITHUB_API_BASE_URL}/app/installations/${installationId}/access_tokens`

				// Create client with GitHub headers
				const client = httpClient.pipe(
					HttpClient.mapRequest(
						HttpClientRequest.setHeaders({
							Accept: "application/vnd.github+json",
							Authorization: `Bearer ${appJwt}`,
							"X-GitHub-Api-Version": "2022-11-28",
						}),
					),
				)

				const response = yield* client.post(url).pipe(Effect.scoped)

				// Handle error status codes
				if (response.status >= 400) {
					const errorBody = yield* response.json.pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(GitHubErrorApiResponse)),
						Effect.catch((error) =>
							Effect.logDebug(`Failed to parse GitHub error response: ${String(error)}`).pipe(
								Effect.as({ message: "Unknown error" }),
							),
						),
					)
					return yield* Effect.fail(
						new GitHubInstallationTokenError({
							installationId,
							message: `GitHub API error: ${response.status} ${errorBody.message}`,
							status: response.status,
						}),
					)
				}

				// Parse successful response
				const data = yield* response.json.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(InstallationTokenApiResponse)),
					Effect.mapError(
						(error) =>
							new GitHubInstallationTokenError({
								installationId,
								message: `Failed to parse installation token response: ${String(error)}`,
								cause: error,
							}),
					),
				)

				return {
					token: data.token,
					expiresAt: new Date(data.expires_at),
				} satisfies InstallationToken
			}).pipe(
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new GitHubInstallationTokenError({
							installationId,
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
				Effect.withSpan("GitHubAppJWTService.generateInstallationToken", {
					attributes: { installationId },
				}),
			)

		/**
		 * Generate a fresh installation access token.
		 */
		const getInstallationToken = Effect.fn("GitHubAppJWTService.getInstallationToken")(function* (
			installationId: string,
		) {
			// Generate a fresh JWT for this request
			const jwt = yield* generateAppJWT(config.appId, config.privateKey)

			// Exchange JWT for installation token
			const token = yield* generateInstallationToken(installationId, jwt)

			return token
		})

		return {
			getAppSlug,
			buildInstallationUrl,
			getInstallationToken,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}
