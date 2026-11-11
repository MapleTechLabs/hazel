/**
 * Browser-safe exports for GitHub integrations.
 * Use this entry point in browser/client code to avoid node:crypto dependencies.
 */

// Browser-safe exports
export * from "./colors.ts"
export * from "./embed-builder.ts"

// API client (browser-safe parts)
export {
	GitHubAccountInfo,
	GitHubApiClient,
	GitHubApiError,
	GitHubPR,
	GitHubPRAuthor,
	GitHubPRLabel,
	GitHubPRNotFoundError,
	GitHubRateLimitError,
	GitHubRepositoriesResult,
	GitHubRepository as GitHubApiRepository,
	GitHubRepositoryOwner,
	isGitHubPRUrl,
	parseGitHubPRUrl,
} from "./api-client.ts"
