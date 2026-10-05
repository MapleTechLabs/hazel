import { IntegrationConnectionRepo, IntegrationTokenRepo } from "@hazel/backend-core"
import type { IntegrationConnectionId, IntegrationTokenId } from "@hazel/schema"
import { IntegrationConnection } from "@hazel/domain/models"
import { GitHub } from "@hazel/integrations"
import { IntegrationConnectionId as IntegrationConnectionIdSchema } from "@hazel/schema"
import { Context, Effect, Layer, Option, PartitionedSemaphore, Redacted, Schema } from "effect"
import { type EncryptedToken, IntegrationEncryption } from "./integration-encryption"
import { OAuthHttpClient } from "./oauth/oauth-http-client"
import { type OAuthIntegrationProvider, loadProviderConfig } from "./oauth/provider-config"

export class TokenNotFoundError extends Schema.TaggedError<TokenNotFoundError>()("TokenNotFoundError", {
	connectionId: IntegrationConnectionIdSchema,
}) {}

export class TokenRefreshError extends Schema.TaggedError<TokenRefreshError>()("TokenRefreshError", {
	provider: IntegrationConnection.IntegrationProvider,
	cause: Schema.Unknown,
}) {}

export class ConnectionNotFoundError extends Schema.TaggedError<ConnectionNotFoundError>()(
	"ConnectionNotFoundError",
	{
		connectionId: IntegrationConnectionIdSchema,
	},
) {}

/**
 * Providers that use app-based token regeneration (JWT) instead of OAuth refresh tokens.
 * These providers regenerate tokens on-demand rather than using refresh tokens.
 */
const APP_BASED_PROVIDERS: readonly IntegrationConnection.IntegrationProvider[] = ["github"] as const

interface OAuthTokenResponse {
	accessToken: string
	refreshToken?: string
	expiresAt?: Date
	scope?: string
}

// Helper to refresh OAuth tokens for each provider using Effect HttpClient
const refreshOAuthToken = (
	provider: OAuthIntegrationProvider,
	refreshToken: string,
	clientId: string,
	clientSecret: string,
): Effect.Effect<OAuthTokenResponse, TokenRefreshError> =>
	Effect.gen(function* () {
		const oauthClient = yield* OAuthHttpClient
		const result = yield* oauthClient.refreshToken(provider, {
			refreshToken,
			clientId,
			clientSecret,
		})

		return {
			accessToken: result.accessToken,
			refreshToken: result.refreshToken,
			expiresAt: result.expiresAt,
			scope: result.scope,
		}
	}).pipe(
		Effect.provide(OAuthHttpClient.layer),
		Effect.mapError((cause) => new TokenRefreshError({ provider, cause })),
	)

export class IntegrationTokenService extends Context.Service<IntegrationTokenService>()(
	"IntegrationTokenService",
	{
		make: Effect.gen(function* () {
			const encryption = yield* IntegrationEncryption
			const tokenRepo = yield* IntegrationTokenRepo
			const connectionRepo = yield* IntegrationConnectionRepo

			// Partitioned semaphore to prevent concurrent token refreshes for the same connection
			const refreshSemaphore = PartitionedSemaphore.makeUnsafe<IntegrationConnectionId>({ permits: 1 })

			/**
			 * Get a valid access token, refreshing if necessary.
			 * Returns the decrypted access token ready for API use.
			 */
			const getValidAccessToken = Effect.fn("IntegrationTokenService.getValidAccessToken")(function* (
				connectionId: IntegrationConnectionId,
			) {
				const tokenOption = yield* tokenRepo.findByConnectionId(connectionId)
				const token = yield* Option.match(tokenOption, {
					onNone: () => Effect.fail(new TokenNotFoundError({ connectionId })),
					onSome: Effect.succeed,
				})

				// Check if token is expired or about to expire (10 min buffer)
				const now = Date.now()
				const expiryBuffer = 10 * 60 * 1000 // 10 minutes
				const needsRefresh = token.expiresAt && token.expiresAt.getTime() - now < expiryBuffer

				if (needsRefresh) {
					// Get connection to determine provider
					const connectionOption = yield* connectionRepo.findById(connectionId)

					const connection = yield* Option.match(connectionOption, {
						onNone: () => Effect.fail(new ConnectionNotFoundError({ connectionId })),
						onSome: Effect.succeed,
					})

					// Check if this is an app-based provider (uses JWT regeneration)
					const isAppBased = (APP_BASED_PROVIDERS as readonly string[]).includes(
						connection.provider,
					)

					if (isAppBased) {
						// App-based providers (like GitHub App) regenerate tokens via JWT
						return yield* refreshSemaphore.withPermits(
							connectionId,
							1,
						)(
							Effect.gen(function* () {
								// Re-fetch token to check if it was already refreshed while waiting
								const freshTokenOption = yield* tokenRepo.findByConnectionId(connectionId)

								const freshToken = yield* Option.match(freshTokenOption, {
									onNone: () => Effect.fail(new TokenNotFoundError({ connectionId })),
									onSome: Effect.succeed,
								})

								const freshNow = Date.now()
								const stillNeedsRefresh =
									freshToken.expiresAt &&
									freshToken.expiresAt.getTime() - freshNow < expiryBuffer

								if (stillNeedsRefresh) {
									// Still needs refresh - regenerate via JWT
									return yield* regenerateAppToken(connectionId, connection, freshToken.id)
								}

								// Token was already refreshed by another request - just decrypt and return
								return yield* encryption.decrypt({
									ciphertext: freshToken.encryptedAccessToken,
									iv: freshToken.iv,
									keyVersion: freshToken.encryptionKeyVersion,
								})
							}),
						)
					}

					// Standard OAuth refresh flow
					if (token.encryptedRefreshToken) {
						// Use partitioned semaphore to prevent concurrent refreshes for the same connection
						// Re-read token inside semaphore to check if another request already refreshed it
						return yield* refreshSemaphore.withPermits(
							connectionId,
							1,
						)(
							Effect.gen(function* () {
								// Re-fetch token to check if it was already refreshed while waiting
								const freshTokenOption = yield* tokenRepo.findByConnectionId(connectionId)

								const freshToken = yield* Option.match(freshTokenOption, {
									onNone: () => Effect.fail(new TokenNotFoundError({ connectionId })),
									onSome: Effect.succeed,
								})

								const freshNow = Date.now()
								const stillNeedsRefresh =
									freshToken.expiresAt &&
									freshToken.expiresAt.getTime() - freshNow < expiryBuffer

								if (stillNeedsRefresh && freshToken.encryptedRefreshToken) {
									// Still needs refresh - do the actual refresh
									return yield* refreshAndGetToken(connectionId, freshToken)
								}

								// Token was already refreshed by another request - just decrypt and return
								return yield* encryption.decrypt({
									ciphertext: freshToken.encryptedAccessToken,
									iv: freshToken.iv,
									keyVersion: freshToken.encryptionKeyVersion,
								})
							}),
						)
					}
				}

				// Decrypt and return current token
				return yield* encryption.decrypt({
					ciphertext: token.encryptedAccessToken,
					iv: token.iv,
					keyVersion: token.encryptionKeyVersion,
				})
			})

			const refreshAndGetToken = Effect.fn("IntegrationTokenService.refreshAndGetToken")(function* (
				connectionId: IntegrationConnectionId,
				token: {
					id: IntegrationTokenId
					encryptedAccessToken: string
					encryptedRefreshToken: string | null
					iv: string
					refreshTokenIv: string | null
					encryptionKeyVersion: number
				},
			) {
				// Get connection to determine provider
				const connectionOption = yield* connectionRepo.findById(connectionId)
				const connection = yield* Option.match(connectionOption, {
					onNone: () => Effect.fail(new ConnectionNotFoundError({ connectionId })),
					onSome: Effect.succeed,
				})

				if (!token.encryptedRefreshToken || !token.refreshTokenIv) {
					return yield* Effect.fail(
						new TokenRefreshError({
							provider: connection.provider,
							cause: "No refresh token available",
						}),
					)
				}

				// Decrypt refresh token using its dedicated IV
				const decryptedRefreshToken = yield* encryption.decrypt({
					ciphertext: token.encryptedRefreshToken,
					iv: token.refreshTokenIv,
					keyVersion: token.encryptionKeyVersion,
				})

				// Load provider config to get client credentials
				const providerConfig = yield* loadProviderConfig(
					connection.provider as OAuthIntegrationProvider,
				).pipe(
					Effect.mapError(
						(cause) =>
							new TokenRefreshError({
								provider: connection.provider,
								cause: `Failed to load provider config: ${cause}`,
							}),
					),
				)

				yield* Effect.logDebug("Refreshing OAuth token", { provider: connection.provider })

				// Call provider's token refresh endpoint
				const newTokens = yield* refreshOAuthToken(
					connection.provider as OAuthIntegrationProvider,
					decryptedRefreshToken,
					providerConfig.clientId,
					Redacted.value(providerConfig.clientSecret),
				)

				// Encrypt and store the new tokens
				const encryptedAccess = yield* encryption.encrypt(newTokens.accessToken)
				// Always re-encrypt the refresh token with the current key version to avoid
				// key version mismatch when the provider doesn't return a new refresh token.
				// If provider returned a new refresh token, use it; otherwise re-encrypt the
				// existing decrypted refresh token with the current key.
				const refreshTokenToStore = newTokens.refreshToken ?? decryptedRefreshToken
				const encryptedRefresh = yield* encryption.encrypt(refreshTokenToStore)

				// Update the token in the database
				yield* tokenRepo.updateToken(token.id, {
					encryptedAccessToken: encryptedAccess.ciphertext,
					encryptedRefreshToken: encryptedRefresh.ciphertext,
					iv: encryptedAccess.iv,
					refreshTokenIv: encryptedRefresh.iv,
					encryptionKeyVersion: encryptedAccess.keyVersion,
					expiresAt: newTokens.expiresAt ?? null,
					scope: newTokens.scope ?? null,
				})

				yield* Effect.logInfo("AUDIT: OAuth token refreshed", {
					event: "token_refresh",
					provider: connection.provider,
					connectionId,
					success: true,
				})

				// Return the new access token
				return newTokens.accessToken
			})

			/**
			 * Regenerate token for app-based providers (like GitHub App).
			 * Uses JWT to request a new installation access token.
			 */
			const regenerateAppToken = Effect.fn("IntegrationTokenService.regenerateAppToken")(function* (
				connectionId: IntegrationConnectionId,
				connection: { provider: IntegrationConnection.IntegrationProvider; metadata: unknown },
				tokenId: IntegrationTokenId,
			) {
				if (connection.provider === "github") {
					// Get installation ID from connection metadata
					const metadata = connection.metadata as { installationId?: string } | null
					const installationId = metadata?.installationId

					if (!installationId) {
						yield* Effect.logWarning("AUDIT: Token refresh failed - missing installation ID", {
							event: "app_token_regenerate_failed",
							provider: connection.provider,
							connectionId,
							errorType: "MissingInstallationId",
						})
						return yield* Effect.fail(
							new TokenRefreshError({
								provider: connection.provider,
								cause: "No installation ID found in connection metadata",
							}),
						)
					}

					yield* Effect.logDebug("Regenerating GitHub App token", { installationId, connectionId })

					// Use GitHub App JWT service to generate a new installation token
					const jwtService = yield* GitHub.GitHubAppJWTService
					const installationToken = yield* jwtService.getInstallationToken(installationId).pipe(
						Effect.tapError((originalError) =>
							Effect.logWarning("AUDIT: GitHub App token regeneration failed", {
								event: "app_token_regenerate_failed",
								provider: connection.provider,
								connectionId,
								installationId,
								errorType: "_tag" in originalError ? originalError._tag : "UnknownError",
								errorMessage:
									"message" in originalError
										? originalError.message
										: String(originalError),
							}),
						),
						Effect.mapError((originalError) => {
							// Preserve specific error details for better debugging
							const errorDetails = {
								type: "_tag" in originalError ? originalError._tag : "UnknownError",
								message:
									"message" in originalError
										? originalError.message
										: String(originalError),
								status: "status" in originalError ? originalError.status : undefined,
							}

							return new TokenRefreshError({
								provider: connection.provider,
								cause: errorDetails,
							})
						}),
					)

					// Encrypt and store the new token
					const encryptedAccess = yield* encryption.encrypt(installationToken.token)

					// Update the token in the database (no refresh token for GitHub App)
					yield* tokenRepo.updateToken(tokenId, {
						encryptedAccessToken: encryptedAccess.ciphertext,
						iv: encryptedAccess.iv,
						encryptionKeyVersion: encryptedAccess.keyVersion,
						expiresAt: installationToken.expiresAt,
					})

					yield* Effect.logInfo("AUDIT: GitHub App token regenerated", {
						event: "app_token_regenerate",
						provider: "github",
						connectionId,
						installationId,
						success: true,
					})

					return installationToken.token
				}

				// Fallback for other app-based providers (not implemented yet)
				return yield* Effect.fail(
					new TokenRefreshError({
						provider: connection.provider,
						cause: `App-based token regeneration not implemented for provider: ${connection.provider}`,
					}),
				)
			})

			/**
			 * Store new tokens after OAuth callback
			 */
			const storeTokens = Effect.fn("IntegrationTokenService.storeTokens")(function* (
				connectionId: IntegrationConnectionId,
				tokens: {
					accessToken: string
					refreshToken?: string
					expiresAt?: Date
					scope?: string
				},
			) {
				// Encrypt tokens
				const encryptedAccess = yield* encryption.encrypt(tokens.accessToken)
				const encryptedRefresh = tokens.refreshToken
					? yield* encryption.encrypt(tokens.refreshToken)
					: null

				// Check if token already exists for this connection
				const existingToken = yield* tokenRepo.findByConnectionId(connectionId)

				if (Option.isSome(existingToken)) {
					// Update existing token
					yield* tokenRepo.updateToken(existingToken.value.id, {
						encryptedAccessToken: encryptedAccess.ciphertext,
						encryptedRefreshToken: encryptedRefresh?.ciphertext ?? null,
						iv: encryptedAccess.iv,
						refreshTokenIv: encryptedRefresh?.iv ?? null,
						encryptionKeyVersion: encryptedAccess.keyVersion,
						expiresAt: tokens.expiresAt ?? null,
						scope: tokens.scope ?? null,
					})
				} else {
					// Create new token
					yield* tokenRepo.insert({
						connectionId,
						encryptedAccessToken: encryptedAccess.ciphertext,
						encryptedRefreshToken: encryptedRefresh?.ciphertext ?? null,
						iv: encryptedAccess.iv,
						refreshTokenIv: encryptedRefresh?.iv ?? null,
						encryptionKeyVersion: encryptedAccess.keyVersion,
						tokenType: "Bearer",
						expiresAt: tokens.expiresAt ?? null,
						refreshTokenExpiresAt: null,
						scope: tokens.scope ?? null,
						lastRefreshedAt: null,
					})
				}
			})

			/**
			 * Delete tokens for a connection (called when disconnecting)
			 */
			const deleteTokens = Effect.fn("IntegrationTokenService.deleteTokens")(function* (
				connectionId: IntegrationConnectionId,
			) {
				yield* tokenRepo.deleteByConnectionId(connectionId)
			})

			return {
				getValidAccessToken,
				storeTokens,
				deleteTokens,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(IntegrationEncryption.layer),
		Layer.provide(IntegrationTokenRepo.layer),
		Layer.provide(IntegrationConnectionRepo.layer),
		Layer.provide(GitHub.GitHubAppJWTService.layer),
	)
}
