import type { GitHub } from "@hazel/integrations"
import { Effect } from "effect"
import { AccountInfoError, type OAuthProvider, TokenExchangeError } from "../oauth-provider"
import type { AppProviderConfig, OAuthTokens } from "../provider-config"

/**
 * Service interface for GitHub App JWT operations.
 * This type matches the service returned by GitHubAppJWTService.
 */
interface GitHubAppJWTServiceInterface {
	readonly buildInstallationUrl: (state: string) => Effect.Effect<URL, GitHub.GitHubAppJWTError>
	readonly getInstallationToken: (
		installationId: string,
	) => Effect.Effect<
		GitHub.InstallationToken,
		GitHub.GitHubAppJWTError | GitHub.GitHubInstallationTokenError
	>
}

/**
 * Service interface for GitHub API Client operations.
 * This type matches the service returned by GitHubApiClient.
 */
interface GitHubApiClientInterface {
	readonly getAccountInfo: (
		accessToken: string,
	) => Effect.Effect<GitHub.GitHubAccountInfo, GitHub.GitHubApiError | GitHub.GitHubRateLimitError>
}

/**
 * GitHub App Provider Implementation.
 *
 * Unlike OAuth Apps, GitHub Apps use a different flow:
 * 1. User is redirected to install the app on their org/repos
 * 2. GitHub redirects back with an `installation_id` (not a code)
 * 3. We use the installation_id to generate short-lived access tokens via JWT
 *
 * Key differences from OAuth:
 * - Authorization URL is the app installation page
 * - "Code" in callback is actually the installation_id
 * - Tokens are generated via JWT, not exchanged
 * - Tokens expire in 1 hour and must be regenerated
 *
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
 */
export const createGitHubAppProvider = (
	config: AppProviderConfig,
	jwtService: GitHubAppJWTServiceInterface,
	apiClient: GitHubApiClientInterface,
): OAuthProvider => ({
	provider: "github",
	config,

	/**
	 * Build the GitHub App installation URL.
	 * This redirects users to install the app on their account/org.
	 */
	// The registry builds this provider only when the app is configured, so the error is a defect.
	buildAuthorizationUrl: (state: string) => jwtService.buildInstallationUrl(state).pipe(Effect.orDie),

	/**
	 * Exchange installation ID for tokens.
	 *
	 * NOTE: For GitHub Apps, the "code" parameter is actually the installation_id
	 * passed by GitHub in the callback URL.
	 */
	exchangeCodeForTokens: (installationId: string) =>
		jwtService.getInstallationToken(installationId).pipe(
			Effect.map(
				(installationToken) =>
					({
						accessToken: installationToken.token,
						refreshToken: undefined, // GitHub Apps don't use refresh tokens
						expiresAt: installationToken.expiresAt,
						scope: undefined,
						tokenType: "Bearer",
					}) satisfies OAuthTokens,
			),
			Effect.mapError(
				(error) =>
					new TokenExchangeError({
						provider: "github",
						message: `Failed to get installation token: ${error.message}`,
						cause: error,
					}),
			),
		),

	/**
	 * Get account info from GitHub API.
	 *
	 * For GitHub Apps, we fetch the installation details to get the account name.
	 * The installation_id is stored in the connection settings.
	 */
	getAccountInfo: (accessToken: string) =>
		apiClient.getAccountInfo(accessToken).pipe(
			Effect.mapError(
				(error) =>
					new AccountInfoError({
						provider: "github",
						message: `Failed to get GitHub account info: ${error.message}`,
						cause: error,
					}),
			),
		),

	// GitHub Apps use JWT-based token regeneration, not refresh tokens
	// The token service handles regeneration via GitHubAppJWTService
})
