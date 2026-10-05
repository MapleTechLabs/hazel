import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { Context, Duration, Effect, Layer, Schedule, Schema } from "effect"

/**
 * GitHub PR URL patterns:
 * - https://github.com/{owner}/{repo}/pull/{number}
 * - https://github.com/{owner}/{repo}/pull/{number}/files
 * - https://github.com/{owner}/{repo}/pull/{number}/commits
 */
const GITHUB_PR_URL_REGEX = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i

/**
 * GitHub username/org and repo name validation pattern.
 * Allows alphanumeric, hyphens, underscores, dots (standard GitHub naming).
 */
const GITHUB_NAME_REGEX = /^[\w.-]+$/

// ============================================================================
// Domain Schemas (exported for consumers)
// ============================================================================

// Schema for GitHub PR author
export const GitHubPRAuthor = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

// Schema for GitHub PR label
export const GitHubPRLabel = Schema.Struct({
	name: Schema.String,
	color: Schema.String,
})

// Full GitHub PR schema (domain model)
export const GitHubPR = Schema.Struct({
	owner: Schema.String,
	repo: Schema.String,
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.Literals(["open", "closed"]),
	draft: Schema.Boolean,
	merged: Schema.Boolean,
	author: Schema.NullOr(GitHubPRAuthor),
	additions: Schema.Number,
	deletions: Schema.Number,
	headRefName: Schema.String,
	updatedAt: Schema.String,
	labels: Schema.Array(GitHubPRLabel),
})

export type GitHubPR = typeof GitHubPR.Type

// Schema for repository owner
export const GitHubRepositoryOwner = Schema.Struct({
	id: Schema.Number,
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

export type GitHubRepositoryOwner = typeof GitHubRepositoryOwner.Type

// Schema for repository (domain model)
export const GitHubRepository = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	fullName: Schema.String,
	private: Schema.Boolean,
	htmlUrl: Schema.String,
	description: Schema.NullOr(Schema.String),
	owner: GitHubRepositoryOwner,
})

export type GitHubRepository = typeof GitHubRepository.Type

// Schema for repositories response (domain model)
export const GitHubRepositoriesResult = Schema.Struct({
	totalCount: Schema.Number,
	repositories: Schema.Array(GitHubRepository),
	hasNextPage: Schema.Boolean,
	page: Schema.Number,
	perPage: Schema.Number,
})

export type GitHubRepositoriesResult = typeof GitHubRepositoriesResult.Type

// Schema for account info (domain model)
export const GitHubAccountInfo = Schema.Struct({
	externalAccountId: Schema.String,
	externalAccountName: Schema.String,
})

export type GitHubAccountInfo = typeof GitHubAccountInfo.Type

// ============================================================================
// Error Types
// ============================================================================

// Error for when GitHub API request fails
export class GitHubApiError extends Schema.TaggedError<GitHubApiError>()("GitHubApiError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

// Error for when PR is not found
export class GitHubPRNotFoundError extends Schema.TaggedError<GitHubPRNotFoundError>()(
	"GitHubPRNotFoundError",
	{
		owner: Schema.String,
		repo: Schema.String,
		number: Schema.Number,
	},
) {}

// Error for when rate limit is exceeded
export class GitHubRateLimitError extends Schema.TaggedError<GitHubRateLimitError>()("GitHubRateLimitError", {
	message: Schema.String,
	retryAfter: Schema.optional(Schema.Number), // seconds until rate limit resets
}) {}

// ============================================================================
// GitHub API Response Schemas (internal, for validation)
// ============================================================================

// GitHub API PR response schema
const GitHubPRApiResponse = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.String,
	draft: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	merged: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	user: Schema.NullOr(
		Schema.Struct({
			login: Schema.String,
			avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
		}),
	),
	additions: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
	deletions: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
	head: Schema.optional(Schema.Struct({ ref: Schema.String })),
	updated_at: Schema.optional(Schema.String),
	labels: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			color: Schema.String,
		}),
	).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

// GitHub API repository owner response schema
const GitHubRepositoryOwnerApiResponse = Schema.Struct({
	id: Schema.Number,
	login: Schema.String,
	avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
})

// GitHub API repository response schema
const GitHubRepositoryApiResponse = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	full_name: Schema.String,
	private: Schema.Boolean,
	html_url: Schema.String,
	description: Schema.NullOr(Schema.String),
	owner: GitHubRepositoryOwnerApiResponse,
})

// GitHub API repositories list response schema
const GitHubRepositoriesApiResponse = Schema.Struct({
	total_count: Schema.Number,
	repositories: Schema.Array(GitHubRepositoryApiResponse),
})

// GitHub API error response schema
const GitHubErrorApiResponse = Schema.Struct({
	message: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("Unknown error"))),
})

// GitHub App info response schema
const GitHubAppApiResponse = Schema.Struct({
	id: Schema.Number,
	name: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("GitHub App"))),
})

// ============================================================================
// URL Parsing Utilities
// ============================================================================

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number.
 * Includes validation of extracted values to prevent injection attacks.
 */
export const parseGitHubPRUrl = (url: string): { owner: string; repo: string; number: number } | null => {
	const match = url.match(GITHUB_PR_URL_REGEX)
	if (!match || !match[1] || !match[2] || !match[3]) return null

	const owner = match[1]
	const repo = match[2]
	const numberStr = match[3]

	// Validate owner and repo names match GitHub naming conventions
	if (!GITHUB_NAME_REGEX.test(owner) || !GITHUB_NAME_REGEX.test(repo)) {
		return null
	}

	// Validate PR number is a positive integer
	const number = Number.parseInt(numberStr, 10)
	if (!Number.isFinite(number) || number <= 0) {
		return null
	}

	return { owner, repo, number }
}

/**
 * Check if a URL is a GitHub PR URL
 */
export const isGitHubPRUrl = (url: string): boolean => {
	return GITHUB_PR_URL_REGEX.test(url)
}

// ============================================================================
// Error Message Parsing
// ============================================================================

/**
 * Parse GitHub API error to provide user-friendly messages
 */
const parseGitHubErrorMessage = (status: number, message: string): string => {
	const lowerMessage = message.toLowerCase()

	// Not found
	if (status === 404 || lowerMessage.includes("not found")) {
		return "Pull request not found or you don't have access"
	}

	// Authentication errors
	if (status === 401 || status === 403) {
		return "GitHub authentication failed"
	}

	// Rate limiting (403 with rate limit message)
	if (status === 403 && lowerMessage.includes("rate limit")) {
		return "Rate limit exceeded, try again later"
	}

	// Return original message if no specific case matches
	return message
}

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_API_BASE_URL = "https://api.github.com"
const DEFAULT_TIMEOUT = Duration.seconds(30)

// ============================================================================
// Retry Strategy
// ============================================================================

/**
 * Retry schedule for transient GitHub API errors.
 * Retries up to 3 times with exponential backoff (100ms, 200ms, 400ms)
 * only for rate limits (429) and server errors (5xx).
 */
const makeRetrySchedule = Schedule.max([Schedule.exponential("100 millis"), Schedule.recurs(3)])

/**
 * Check if an error is retryable (rate limit or server error)
 */
const isRetryableError = (error: GitHubApiError | GitHubRateLimitError | GitHubPRNotFoundError): boolean => {
	if (error._tag === "GitHubRateLimitError") {
		return true
	}
	if (error._tag === "GitHubApiError" && error.status !== undefined) {
		return error.status === 429 || error.status >= 500
	}
	return false
}

// ============================================================================
// GitHubApiClient Service
// ============================================================================

/**
 * GitHub API Client Service.
 *
 * Provides methods for interacting with the GitHub API using Effect HttpClient
 * with proper schema validation, retries, and timeouts.
 *
 * ## Usage
 *
 * ```typescript
 * // Using accessors (preferred)
 * const pr = yield* GitHubApiClient.fetchPR("owner", "repo", 123, accessToken)
 *
 * // Or via service instance
 * const client = yield* GitHubApiClient
 * const pr = yield* client.fetchPR("owner", "repo", 123, accessToken)
 * ```
 *
 * ## Features
 * - Automatic retry with exponential backoff for transient errors (429, 5xx)
 * - 30 second timeout on all requests
 * - Rate limit handling with retry-after header support
 * - Distributed tracing via Effect spans
 */
export class GitHubApiClient extends Context.Service<GitHubApiClient>()("GitHubApiClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		/**
		 * Create an authenticated client with GitHub headers
		 */
		const makeAuthenticatedClient = (accessToken: string) =>
			httpClient.pipe(
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						Authorization: `Bearer ${accessToken}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
					}),
				),
			)

		/**
		 * Create an unauthenticated client with GitHub headers (for public API)
		 */
		const makeUnauthenticatedClient = () =>
			httpClient.pipe(
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
					}),
				),
			)

		/**
		 * Fetch a GitHub PR by owner, repo, and number
		 */
		const fetchPR = Effect.fn("GitHubApiClient.fetchPR")(function* (
			owner: string,
			repo: string,
			prNumber: number,
			accessToken: string,
		) {
			const client = makeAuthenticatedClient(accessToken)
			const url = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}`

			const response = yield* client.get(url).pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			// Handle 404 as not found error
			if (response.status === 404) {
				return yield* Effect.fail(new GitHubPRNotFoundError({ owner, repo, number: prNumber }))
			}

			// Handle 429 rate limit with retry-after header
			if (response.status === 429) {
				const retryAfterHeader = response.headers["retry-after"]
				const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
				return yield* Effect.fail(
					new GitHubRateLimitError({
						message: "Rate limit exceeded",
						retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
					}),
				)
			}

			// Handle other error status codes
			if (response.status >= 400) {
				const errorBody = yield* response.json.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(GitHubErrorApiResponse)),
					Effect.catch((error) =>
						Effect.logDebug(`Failed to parse GitHub error response: ${String(error)}`).pipe(
							Effect.as({ message: "Unknown error" }),
						),
					),
				)
				const message = parseGitHubErrorMessage(response.status, errorBody.message)
				return yield* Effect.fail(new GitHubApiError({ message, status: response.status }))
			}

			// Parse successful response
			const prData = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(GitHubPRApiResponse)),
				Effect.mapError(
					(error) =>
						new GitHubApiError({
							message: `Failed to parse GitHub PR response: ${String(error)}`,
							cause: error,
						}),
				),
			)

			// Transform API response to domain model
			return {
				owner,
				repo,
				number: prData.number,
				title: prData.title,
				body: prData.body ?? null,
				state: prData.state as "open" | "closed",
				draft: prData.draft,
				merged: prData.merged,
				author: prData.user
					? {
							login: prData.user.login,
							avatarUrl: prData.user.avatar_url ?? null,
						}
					: null,
				additions: prData.additions,
				deletions: prData.deletions,
				headRefName: prData.head?.ref ?? "",
				updatedAt: prData.updated_at ?? new Date().toISOString(),
				labels: prData.labels.map((label) => ({
					name: label.name,
					color: label.color,
				})),
			} satisfies GitHubPR
		})

		/**
		 * Fetch a GitHub PR from the public API (unauthenticated).
		 * Limited to 60 requests/hour per IP.
		 */
		const fetchPRPublic = Effect.fn("GitHubApiClient.fetchPRPublic")(function* (
			owner: string,
			repo: string,
			prNumber: number,
		) {
			const client = makeUnauthenticatedClient()
			const url = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}`

			const response = yield* client.get(url).pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			// Handle 404 as not found error
			if (response.status === 404) {
				return yield* Effect.fail(new GitHubPRNotFoundError({ owner, repo, number: prNumber }))
			}

			// Handle 429 rate limit with retry-after header
			if (response.status === 429) {
				const retryAfterHeader = response.headers["retry-after"]
				const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
				return yield* Effect.fail(
					new GitHubRateLimitError({
						message:
							"Public API rate limit exceeded (60 req/hour). Connect GitHub for higher limits.",
						retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
					}),
				)
			}

			// Handle 403 which GitHub uses for rate limiting on unauthenticated requests
			if (response.status === 403) {
				const errorBody = yield* response.json.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(GitHubErrorApiResponse)),
					Effect.catch(() => Effect.succeed({ message: "" })),
				)
				if (errorBody.message.toLowerCase().includes("rate limit")) {
					return yield* Effect.fail(
						new GitHubRateLimitError({
							message:
								"Public API rate limit exceeded (60 req/hour). Connect GitHub for higher limits.",
						}),
					)
				}
				return yield* Effect.fail(
					new GitHubApiError({ message: errorBody.message || "Forbidden", status: 403 }),
				)
			}

			// Handle other error status codes
			if (response.status >= 400) {
				const errorBody = yield* response.json.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(GitHubErrorApiResponse)),
					Effect.catch((error) =>
						Effect.logDebug(`Failed to parse GitHub error response: ${String(error)}`).pipe(
							Effect.as({ message: "Unknown error" }),
						),
					),
				)
				const message = parseGitHubErrorMessage(response.status, errorBody.message)
				return yield* Effect.fail(new GitHubApiError({ message, status: response.status }))
			}

			// Parse successful response
			const prData = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(GitHubPRApiResponse)),
				Effect.mapError(
					(error) =>
						new GitHubApiError({
							message: `Failed to parse GitHub PR response: ${String(error)}`,
							cause: error,
						}),
				),
			)

			// Transform API response to domain model
			return {
				owner,
				repo,
				number: prData.number,
				title: prData.title,
				body: prData.body ?? null,
				state: prData.state as "open" | "closed",
				draft: prData.draft,
				merged: prData.merged,
				author: prData.user
					? {
							login: prData.user.login,
							avatarUrl: prData.user.avatar_url ?? null,
						}
					: null,
				additions: prData.additions,
				deletions: prData.deletions,
				headRefName: prData.head?.ref ?? "",
				updatedAt: prData.updated_at ?? new Date().toISOString(),
				labels: prData.labels.map((label) => ({
					name: label.name,
					color: label.color,
				})),
			} satisfies GitHubPR
		})

		/**
		 * Fetch repositories accessible to the GitHub App installation
		 */
		const fetchRepositories = Effect.fn("GitHubApiClient.fetchRepositories")(function* (
			accessToken: string,
			page: number,
			perPage: number,
		) {
			const client = makeAuthenticatedClient(accessToken)
			const url = `${GITHUB_API_BASE_URL}/installation/repositories?per_page=${perPage}&page=${page}`

			const response = yield* client.get(url).pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			// Handle 429 rate limit with retry-after header
			if (response.status === 429) {
				const retryAfterHeader = response.headers["retry-after"]
				const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
				return yield* Effect.fail(
					new GitHubRateLimitError({
						message: "Rate limit exceeded",
						retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
					}),
				)
			}

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
					new GitHubApiError({
						message: `GitHub API error: ${errorBody.message}`,
						status: response.status,
					}),
				)
			}

			// Parse successful response
			const data = yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(GitHubRepositoriesApiResponse)),
				Effect.mapError(
					(error) =>
						new GitHubApiError({
							message: `Failed to parse GitHub repositories response: ${String(error)}`,
							cause: error,
						}),
				),
			)

			// Transform API response to domain model
			const repositories: GitHubRepository[] = data.repositories.map((repo) => ({
				id: repo.id,
				name: repo.name,
				fullName: repo.full_name,
				private: repo.private,
				htmlUrl: repo.html_url,
				description: repo.description ?? null,
				owner: {
					id: repo.owner.id,
					login: repo.owner.login,
					avatarUrl: repo.owner.avatar_url ?? null,
				},
			}))

			const totalCount = data.total_count
			const hasNextPage = page * perPage < totalCount

			return {
				totalCount,
				repositories,
				hasNextPage,
				page,
				perPage,
			} satisfies GitHubRepositoriesResult
		})

		/**
		 * Get account info from the GitHub installation
		 */
		const getAccountInfo = Effect.fn("GitHubApiClient.getAccountInfo")(function* (accessToken: string) {
			const client = makeAuthenticatedClient(accessToken)

			// First, try to get account info from repositories endpoint
			const reposUrl = `${GITHUB_API_BASE_URL}/installation/repositories`
			const reposResponse = yield* client
				.get(reposUrl)
				.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			// Handle 429 rate limit
			if (reposResponse.status === 429) {
				const retryAfterHeader = reposResponse.headers["retry-after"]
				const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
				return yield* Effect.fail(
					new GitHubRateLimitError({
						message: "Rate limit exceeded",
						retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
					}),
				)
			}

			if (reposResponse.status >= 200 && reposResponse.status < 300) {
				const data = yield* reposResponse.json.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(GitHubRepositoriesApiResponse)),
					Effect.catch((error) =>
						Effect.logDebug(
							`Failed to parse GitHub repositories response: ${String(error)}`,
						).pipe(Effect.as({ total_count: 0, repositories: [] })),
					),
				)

				// Get the owner from the first repository
				const firstRepo = data.repositories[0]
				if (firstRepo?.owner) {
					return {
						externalAccountId: String(firstRepo.owner.id),
						externalAccountName: firstRepo.owner.login,
					} satisfies GitHubAccountInfo
				}
			}

			// Fallback: try to get authenticated app info
			const appUrl = `${GITHUB_API_BASE_URL}/app`
			const appResponse = yield* client.get(appUrl).pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

			// Handle 429 rate limit on fallback
			if (appResponse.status === 429) {
				const retryAfterHeader = appResponse.headers["retry-after"]
				const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined
				return yield* Effect.fail(
					new GitHubRateLimitError({
						message: "Rate limit exceeded",
						retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
					}),
				)
			}

			if (appResponse.status >= 200 && appResponse.status < 300) {
				const appData = yield* appResponse.json.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(GitHubAppApiResponse)),
					Effect.catch((error) =>
						Effect.logDebug(`Failed to parse GitHub App response: ${String(error)}`).pipe(
							Effect.as({ id: 0, name: "GitHub App" }),
						),
					),
				)

				return {
					externalAccountId: String(appData.id),
					externalAccountName: appData.name,
				} satisfies GitHubAccountInfo
			}

			// If we can't get account info, use placeholder
			return {
				externalAccountId: "0",
				externalAccountName: "GitHub",
			} satisfies GitHubAccountInfo
		})

		// Apply error handling, retry, and spans to each method
		const wrappedFetchPR = (owner: string, repo: string, prNumber: number, accessToken: string) =>
			fetchPR(owner, repo, prNumber, accessToken).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new GitHubApiError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new GitHubApiError({
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
				Effect.retry({
					schedule: makeRetrySchedule,
					while: isRetryableError,
				}),
				Effect.withSpan("GitHubApiClient.fetchPR", { attributes: { owner, repo, prNumber } }),
			)

		const wrappedFetchPRPublic = (owner: string, repo: string, prNumber: number) =>
			fetchPRPublic(owner, repo, prNumber).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new GitHubApiError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new GitHubApiError({
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
				Effect.retry({
					schedule: makeRetrySchedule,
					while: isRetryableError,
				}),
				Effect.withSpan("GitHubApiClient.fetchPRPublic", { attributes: { owner, repo, prNumber } }),
			)

		const wrappedFetchRepositories = (accessToken: string, page: number, perPage: number) =>
			fetchRepositories(accessToken, page, perPage).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new GitHubApiError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new GitHubApiError({
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
				Effect.retry({
					schedule: makeRetrySchedule,
					while: (error): error is GitHubApiError | GitHubRateLimitError =>
						error._tag === "GitHubApiError" || error._tag === "GitHubRateLimitError"
							? isRetryableError(error)
							: false,
				}),
				Effect.withSpan("GitHubApiClient.fetchRepositories", { attributes: { page, perPage } }),
			)

		const wrappedGetAccountInfo = (accessToken: string) =>
			getAccountInfo(accessToken).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new GitHubApiError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new GitHubApiError({
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
				Effect.retry({
					schedule: makeRetrySchedule,
					while: (error): error is GitHubApiError | GitHubRateLimitError =>
						error._tag === "GitHubApiError" || error._tag === "GitHubRateLimitError"
							? isRetryableError(error)
							: false,
				}),
				Effect.withSpan("GitHubApiClient.getAccountInfo"),
			)

		return {
			fetchPR: wrappedFetchPR,
			fetchPRPublic: wrappedFetchPRPublic,
			fetchRepositories: wrappedFetchRepositories,
			getAccountInfo: wrappedGetAccountInfo,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}

// ============================================================================
// Legacy exports for backwards compatibility
// ============================================================================

/**
 * @deprecated Use GitHubApiClient.fetchPR instead
 *
 * Fetch a GitHub PR by owner, repo, and number using the provided access token.
 * This is a legacy function that creates a temporary GitHubApiClient.
 */
export const fetchGitHubPR = (
	owner: string,
	repo: string,
	prNumber: number,
	accessToken: string,
): Effect.Effect<GitHubPR, GitHubApiError | GitHubPRNotFoundError | GitHubRateLimitError> =>
	Effect.gen(function* () {
		const client = yield* GitHubApiClient
		return yield* client.fetchPR(owner, repo, prNumber, accessToken)
	}).pipe(Effect.provide(GitHubApiClient.layer))
