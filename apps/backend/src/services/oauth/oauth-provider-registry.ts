import { UnsupportedProviderError } from "@hazel/domain/http"
import { GitHub } from "@hazel/integrations"
import { Context, Effect, Layer } from "effect"
import type { OAuthProvider } from "./oauth-provider"
import { ProviderNotConfiguredError } from "./oauth-provider"
import type { IntegrationProvider, OAuthIntegrationProvider, OAuthProviderConfig } from "./provider-config"
import { loadProviderConfig } from "./provider-config"
import { createGitHubAppProvider } from "./providers/github-app-provider"
import { createLinearOAuthProvider } from "./providers/linear-oauth-provider"
import { createDiscordOAuthProvider } from "./providers/discord-oauth-provider"

/**
 * Factory function type for creating OAuth providers.
 */
type ProviderFactory = (config: OAuthProviderConfig) => OAuthProvider

/**
 * Providers that use GitHub App flow (not standard OAuth).
 * These providers get their config from dedicated services, not loadProviderConfig.
 */
const _APP_BASED_PROVIDERS: readonly OAuthIntegrationProvider[] = ["github"] as const

/**
 * Registry of provider factory functions for standard OAuth providers.
 * Add new providers here when implementing them.
 */
const PROVIDER_FACTORIES: Partial<Record<OAuthIntegrationProvider, ProviderFactory>> = {
	linear: createLinearOAuthProvider,
	discord: createDiscordOAuthProvider,
	// Future providers:
	// figma: createFigmaOAuthProvider,
	// notion: createNotionOAuthProvider,
}

/**
 * Providers that are fully implemented and available for use.
 */
const SUPPORTED_PROVIDERS: readonly OAuthIntegrationProvider[] = ["linear", "github", "discord"] as const

/**
 * OAuth Provider Registry Service.
 *
 * Central service for managing OAuth provider instances. Handles:
 * - Loading provider configuration from environment variables
 * - Creating provider instances with their configuration
 * - Caching provider instances for reuse
 *
 * ## Usage
 *
 * ```typescript
 * const registry = yield* OAuthProviderRegistry
 *
 * // Get a provider for the OAuth flow
 * const provider = yield* registry.getProvider("linear")
 *
 * // Build authorization URL
 * const url = yield* provider.buildAuthorizationUrl(state)
 * ```
 *
 * ## Adding a New Provider
 *
 * 1. Create the provider implementation in `providers/{provider}-oauth-provider.ts`
 * 2. Add factory function to PROVIDER_FACTORIES
 * 3. Add provider to SUPPORTED_PROVIDERS array
 * 4. Set environment variables: {PROVIDER}_CLIENT_ID, {PROVIDER}_CLIENT_SECRET, {PROVIDER}_REDIRECT_URI
 */
export class OAuthProviderRegistry extends Context.Service<OAuthProviderRegistry>()("OAuthProviderRegistry", {
	make: Effect.gen(function* () {
		// Cache for loaded providers
		const providerCache = new Map<OAuthIntegrationProvider, OAuthProvider>()

		// Get the GitHub services for creating GitHub provider
		const gitHubJwtService = yield* GitHub.GitHubAppJWTService
		const gitHubApiClient = yield* GitHub.GitHubApiClient

		/**
		 * Get an OAuth provider instance.
		 * Loads configuration and creates provider on first access, then caches.
		 */
		const getProvider = (
			provider: IntegrationProvider,
		): Effect.Effect<OAuthProvider, UnsupportedProviderError | ProviderNotConfiguredError> =>
			Effect.gen(function* () {
				// Check cache first
				const cached = providerCache.get(provider as OAuthIntegrationProvider)
				if (cached) {
					return cached
				}

				// Check if provider is supported (cast needed since provider may include non-OAuth providers like "craft")
				if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
					return yield* Effect.fail(
						new UnsupportedProviderError({
							provider,
						}),
					)
				}

				// After the check above, we know the provider is a valid OAuth provider
				const oauthProvider_ = provider as OAuthIntegrationProvider

				// Handle GitHub App separately (uses JWT service, not standard OAuth)
				if (oauthProvider_ === "github") {
					// Create provider with JWT service and API client
					// Uses minimal AppProviderConfig since GitHub Apps manage their own auth via JWT
					const oauthProvider = createGitHubAppProvider(
						{ provider: "github" },
						gitHubJwtService,
						gitHubApiClient,
					)
					providerCache.set(oauthProvider_, oauthProvider)
					return oauthProvider
				}

				// Get factory function for standard OAuth providers
				const factory = PROVIDER_FACTORIES[oauthProvider_]
				if (!factory) {
					return yield* Effect.fail(
						new UnsupportedProviderError({
							provider,
						}),
					)
				}

				// Load configuration from environment for standard OAuth providers
				const config = yield* loadProviderConfig(oauthProvider_).pipe(
					Effect.mapError(
						(error) =>
							new ProviderNotConfiguredError({
								provider: oauthProvider_,
								message: `Missing configuration for ${provider}: ${String(error)}`,
							}),
					),
				)

				// Create and cache provider
				const oauthProvider = factory(config)
				providerCache.set(oauthProvider_, oauthProvider)

				return oauthProvider
			})

		/**
		 * List all supported/implemented providers.
		 */
		const listSupportedProviders = (): readonly OAuthIntegrationProvider[] => SUPPORTED_PROVIDERS

		/**
		 * Check if a provider is supported.
		 */
		const isProviderSupported = (provider: string): provider is OAuthIntegrationProvider =>
			(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)

		return {
			getProvider,
			listSupportedProviders,
			isProviderSupported,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(GitHub.GitHubAppJWTService.layer),
		Layer.provide(GitHub.GitHubApiClient.layer),
	)
}
