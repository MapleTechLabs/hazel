/**
 * # OAuth Provider System
 *
 * Generic OAuth provider abstraction for integrating with external services
 * like Linear, GitHub, Figma, and Notion.
 *
 * ## Architecture
 *
 * The system uses the Strategy pattern:
 * - `OAuthProvider` interface defines the contract for all providers
 * - Each provider (Linear, GitHub, etc.) implements this interface
 * - `OAuthProviderRegistry` manages provider instances and configuration
 *
 * ## Quick Start
 *
 * ```typescript
 * import { OAuthProviderRegistry } from "./services/oauth"
 *
 * const registry = yield* OAuthProviderRegistry
 * const provider = yield* registry.getProvider("linear")
 *
 * // Build authorization URL for redirect
 * const authUrl = yield* provider.buildAuthorizationUrl(encodedState)
 *
 * // After callback, exchange code for tokens
 * const tokens = yield* provider.exchangeCodeForTokens(code)
 *
 * // Get account info
 * const accountInfo = yield* provider.getAccountInfo(tokens.accessToken)
 * ```
 *
 * ## Environment Variables
 *
 * Required:
 * - `API_BASE_URL` - Your API base URL (e.g., https://api.hazel.sh or http://localhost:3003)
 * - `{PROVIDER}_CLIENT_ID` - OAuth client ID from the provider
 * - `{PROVIDER}_CLIENT_SECRET` - OAuth client secret
 *
 * The redirect URI is automatically derived as: `{API_BASE_URL}/integrations/{provider}/callback`
 *
 * Example for Linear:
 * ```bash
 * API_BASE_URL=https://api.hazel.sh
 * LINEAR_CLIENT_ID=your_client_id
 * LINEAR_CLIENT_SECRET=your_client_secret
 * # Redirect URI auto-generated: https://api.hazel.sh/integrations/linear/callback
 * ```
 *
 * ## Adding a New Provider
 *
 * 1. Create provider implementation:
 *    ```typescript
 *    // providers/github-oauth-provider.ts
 *    import { OAuthProvider, createBaseAuthorizationUrl } from "../oauth-provider"
 *
 *    export const createGitHubOAuthProvider = (config: OAuthProviderConfig): OAuthProvider => ({
 *      provider: "github",
 *      config,
 *      buildAuthorizationUrl: (state) => Effect.succeed(createBaseAuthorizationUrl(config, state)),
 *      exchangeCodeForTokens: (code) => makeTokenExchangeRequest(config, code, clientSecret),
 *      getAccountInfo: (accessToken) => Effect.tryPromise({
 *        try: async () => {
 *          // Fetch user info from GitHub API
 *          const response = await fetch("https://api.github.com/user", {
 *            headers: { Authorization: `Bearer ${accessToken}` }
 *          })
 *          const user = await response.json()
 *          return { externalAccountId: user.id, externalAccountName: user.login }
 *        },
 *        catch: (error) => new AccountInfoError({ provider: "github", message: String(error) })
 *      })
 *    })
 *    ```
 *
 * 2. Register in oauth-provider-registry.ts:
 *    ```typescript
 *    const PROVIDER_FACTORIES = {
 *      linear: createLinearOAuthProvider,
 *      github: createGitHubOAuthProvider, // Add this
 *    }
 *
 *    const SUPPORTED_PROVIDERS = ["linear", "github"] as const // Add here
 *    ```
 *
 * 3. Add provider config in provider-config.ts:
 *    ```typescript
 *    export const PROVIDER_CONFIGS = {
 *      github: {
 *        provider: "github",
 *        authorizationUrl: "https://github.com/login/oauth/authorize",
 *        tokenUrl: "https://github.com/login/oauth/access_token",
 *        scopes: ["read:user", "repo"],
 *        scopeDelimiter: " ",
 *      },
 *      // ...
 *    }
 *    ```
 *
 * 4. Set environment variables and deploy!
 *
 * ## Supported Providers
 *
 * Currently implemented:
 * - **Linear** - Full OAuth support
 *
 * Planned (config defined, not implemented):
 * - GitHub
 * - Figma
 * - Notion
 *
 * @module oauth
 */

export * from "./oauth-provider"
export * from "./oauth-provider-registry"
export * from "./provider-config"
export * from "./providers/discord-oauth-provider"
export * from "./providers/linear-oauth-provider"
