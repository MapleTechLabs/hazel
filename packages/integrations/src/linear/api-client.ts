/**
 * Linear API Client
 *
 * Effect-based HTTP client for Linear GraphQL API with schema validation,
 * retries, and proper error handling.
 */

import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"

// ============================================================================
// Configuration
// ============================================================================

const LINEAR_API_URL = "https://api.linear.app/graphql"
const DEFAULT_TIMEOUT = Duration.seconds(30)

// ============================================================================
// Domain Schemas (exported for consumers)
// ============================================================================

export const LinearIssueState = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	color: Schema.String,
})

export type LinearIssueState = typeof LinearIssueState.Type

export const LinearIssueAssignee = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

export type LinearIssueAssignee = typeof LinearIssueAssignee.Type

export const LinearIssueLabel = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	color: Schema.String,
})

export type LinearIssueLabel = typeof LinearIssueLabel.Type

export const LinearIssue = Schema.Struct({
	id: Schema.String,
	identifier: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	url: Schema.String,
	teamName: Schema.String,
	state: Schema.NullOr(LinearIssueState),
	assignee: Schema.NullOr(LinearIssueAssignee),
	priority: Schema.Number,
	priorityLabel: Schema.String,
	labels: Schema.Array(LinearIssueLabel),
})

export type LinearIssue = typeof LinearIssue.Type

export const LinearTeam = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
})

export type LinearTeam = typeof LinearTeam.Type

export const LinearIssueCreated = Schema.Struct({
	id: Schema.String,
	identifier: Schema.String,
	title: Schema.String,
	url: Schema.String,
	teamName: Schema.String,
})

export type LinearIssueCreated = typeof LinearIssueCreated.Type

export const LinearAccountInfo = Schema.Struct({
	externalAccountId: Schema.String,
	externalAccountName: Schema.String,
})

export type LinearAccountInfo = typeof LinearAccountInfo.Type

// ============================================================================
// Error Types
// ============================================================================

export class LinearApiError extends Schema.TaggedError<LinearApiError>()("LinearApiError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

export class LinearRateLimitError extends Schema.TaggedError<LinearRateLimitError>()("LinearRateLimitError", {
	message: Schema.String,
	retryAfter: Schema.optional(Schema.Number),
}) {}

export class LinearIssueNotFoundError extends Schema.TaggedError<LinearIssueNotFoundError>()(
	"LinearIssueNotFoundError",
	{
		issueId: Schema.String,
	},
) {}

export class LinearTeamNotFoundError extends Schema.TaggedError<LinearTeamNotFoundError>()(
	"LinearTeamNotFoundError",
	{
		message: Schema.String,
	},
) {}

// ============================================================================
// URL Parsing Utilities
// ============================================================================

const LINEAR_ISSUE_URL_REGEX = /^https:\/\/linear\.app\/([^/]+)\/issue\/([A-Z]+-\d+)/i

/**
 * Parse a Linear issue URL to extract workspace and issue key.
 */
export const parseLinearIssueUrl = (url: string): { workspace: string; issueKey: string } | null => {
	const match = url.match(LINEAR_ISSUE_URL_REGEX)
	if (!match || !match[1] || !match[2]) return null
	return {
		workspace: match[1],
		issueKey: match[2],
	}
}

/**
 * Check if a URL is a Linear issue URL
 */
export const isLinearIssueUrl = (url: string): boolean => {
	return LINEAR_ISSUE_URL_REGEX.test(url)
}

/**
 * Extract all Linear issue URLs from content
 */
export const extractLinearUrls = (content: string): string[] => {
	const regex = /https:\/\/linear\.app\/[^/]+\/issue\/[A-Z]+-\d+/gi
	return content.match(regex) ?? []
}

// ============================================================================
// GraphQL Queries/Mutations
// ============================================================================

const GET_DEFAULT_TEAM_QUERY = `
query GetDefaultTeam {
  teams(first: 1) {
    nodes {
      id
      name
    }
  }
}
`

const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($teamId: String!, $title: String!, $description: String) {
  issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
    success
    issue {
      id
      identifier
      title
      url
      team {
        name
      }
    }
  }
}
`

const ISSUE_QUERY = `
query GetIssue($issueId: String!) {
  issue(id: $issueId) {
    id
    identifier
    title
    description
    url
    team {
      name
      key
    }
    state {
      id
      name
      color
    }
    assignee {
      id
      name
      avatarUrl
    }
    priority
    priorityLabel
    labels {
      nodes {
        id
        name
        color
      }
    }
  }
}
`

const VIEWER_QUERY = `
query {
  viewer {
    id
    name
    email
    organization {
      id
      name
    }
  }
}
`

// ============================================================================
// API Response Schemas (internal)
// ============================================================================

const GraphQLError = Schema.Struct({
	message: Schema.String,
})

const GetDefaultTeamResponse = Schema.Struct({
	data: Schema.OptionFromOptional(
		Schema.Struct({
			teams: Schema.Struct({
				nodes: Schema.Array(
					Schema.Struct({
						id: Schema.String,
						name: Schema.String,
					}),
				),
			}),
		}),
	),
	errors: Schema.OptionFromOptional(Schema.Array(GraphQLError)),
})

const CreateIssueResponse = Schema.Struct({
	data: Schema.OptionFromOptional(
		Schema.Struct({
			issueCreate: Schema.Struct({
				success: Schema.Boolean,
				issue: Schema.OptionFromOptional(
					Schema.Struct({
						id: Schema.String,
						identifier: Schema.String,
						title: Schema.String,
						url: Schema.String,
						team: Schema.OptionFromOptional(
							Schema.Struct({
								name: Schema.String,
							}),
						),
					}),
				),
			}),
		}),
	),
	errors: Schema.OptionFromOptional(Schema.Array(GraphQLError)),
})

const GetIssueResponse = Schema.Struct({
	data: Schema.OptionFromNullishOr(
		Schema.Struct({
			issue: Schema.NullOr(
				Schema.Struct({
					id: Schema.String,
					identifier: Schema.String,
					title: Schema.String,
					description: Schema.NullOr(Schema.String),
					url: Schema.String,
					team: Schema.NullOr(
						Schema.Struct({
							name: Schema.String,
							key: Schema.String,
						}),
					),
					state: Schema.NullOr(
						Schema.Struct({
							id: Schema.String,
							name: Schema.String,
							color: Schema.String,
						}),
					),
					assignee: Schema.NullOr(
						Schema.Struct({
							id: Schema.String,
							name: Schema.String,
							avatarUrl: Schema.NullOr(Schema.String),
						}),
					),
					priority: Schema.NullOr(Schema.Number),
					priorityLabel: Schema.NullOr(Schema.String),
					labels: Schema.Struct({
						nodes: Schema.Array(
							Schema.Struct({
								id: Schema.String,
								name: Schema.String,
								color: Schema.String,
							}),
						),
					}),
				}),
			),
		}),
		{ onNoneEncoding: null },
	),
	errors: Schema.OptionFromNullishOr(Schema.Array(GraphQLError), { onNoneEncoding: null }),
})

const ViewerResponse = Schema.Struct({
	data: Schema.OptionFromOptional(
		Schema.Struct({
			viewer: Schema.Struct({
				id: Schema.String,
				name: Schema.String,
				email: Schema.String,
				organization: Schema.NullOr(
					Schema.Struct({
						id: Schema.String,
						name: Schema.String,
					}),
				),
			}),
		}),
	),
	errors: Schema.OptionFromOptional(Schema.Array(GraphQLError)),
})

// ============================================================================
// Error Message Parsing
// ============================================================================

/**
 * Parse Linear API error to provide user-friendly messages
 */
const parseLinearErrorMessage = (errorMessage: string): string => {
	const lowerMessage = errorMessage.toLowerCase()

	if (lowerMessage.includes("entity not found") || lowerMessage.includes("not found")) {
		return "Issue not found or you don't have access"
	}

	if (lowerMessage.includes("unauthorized") || lowerMessage.includes("authentication")) {
		return "Linear authentication failed"
	}

	if (lowerMessage.includes("rate limit") || lowerMessage.includes("too many requests")) {
		return "Rate limit exceeded, try again later"
	}

	return errorMessage
}

// ============================================================================
// Retry Strategy
// ============================================================================

/**
 * Retry schedule for transient Linear API errors.
 * Retries up to 3 times with exponential backoff (100ms, 200ms, 400ms)
 */
const makeRetrySchedule = Schedule.max([Schedule.exponential("100 millis"), Schedule.recurs(3)])

/**
 * Check if an error is retryable (rate limit or server error)
 */
const isRetryableError = (
	error: LinearApiError | LinearRateLimitError | LinearIssueNotFoundError | LinearTeamNotFoundError,
): boolean => {
	if (error._tag === "LinearRateLimitError") {
		return true
	}
	if (error._tag === "LinearApiError" && error.status !== undefined) {
		return error.status === 429 || error.status >= 500
	}
	return false
}

// ============================================================================
// LinearApiClient Service
// ============================================================================

/**
 * Linear API Client Service.
 *
 * Provides methods for interacting with the Linear GraphQL API using Effect HttpClient
 * with proper schema validation, retries, and timeouts.
 *
 * ## Usage
 *
 * ```typescript
 * // Using accessors (preferred)
 * const issue = yield* LinearApiClient.fetchIssue("ENG-123", accessToken)
 *
 * // Or via service instance
 * const client = yield* LinearApiClient
 * const issue = yield* client.fetchIssue("ENG-123", accessToken)
 * ```
 */
export class LinearApiClient extends Context.Service<LinearApiClient>()("LinearApiClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		/**
		 * Create an authenticated client with Linear headers
		 */
		const makeAuthenticatedClient = (accessToken: string) =>
			httpClient.pipe(
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						Authorization: `Bearer ${accessToken}`,
						"Content-Type": "application/json",
					}),
				),
			)

		/**
		 * Execute a GraphQL query and handle all errors
		 */
		const executeGraphQL = <R>(
			client: HttpClient.HttpClient,
			query: string,
			variables: Record<string, unknown> = {},
		): Effect.Effect<R, LinearApiError | LinearRateLimitError> =>
			Effect.gen(function* () {
				const jsonBody = JSON.stringify({ query, variables })

				const response = yield* client
					.post(LINEAR_API_URL, {
						body: HttpBody.text(jsonBody, "application/json"),
					})
					.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

				// Handle 429 rate limit
				if (response.status === 429) {
					return yield* Effect.fail(
						new LinearRateLimitError({
							message: "Rate limit exceeded, try again later",
						}),
					)
				}

				// Handle 401/403 authentication errors
				if (response.status === 401 || response.status === 403) {
					return yield* Effect.fail(
						new LinearApiError({
							message: "Linear authentication failed - please reconnect",
							status: response.status,
						}),
					)
				}

				// Handle other HTTP errors
				if (response.status >= 400) {
					return yield* Effect.fail(
						new LinearApiError({
							message: `Could not connect to Linear (${response.status})`,
							status: response.status,
						}),
					)
				}

				return yield* response.json as Effect.Effect<R>
			}).pipe(
				// Map HTTP client errors to LinearApiError
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new LinearApiError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new LinearApiError({
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
			)

		/**
		 * Get the default team for the authenticated user
		 */
		const getDefaultTeam = (accessToken: string) =>
			Effect.gen(function* () {
				const client = makeAuthenticatedClient(accessToken)
				const rawResponse = yield* executeGraphQL(client, GET_DEFAULT_TEAM_QUERY)

				const response = yield* Schema.decodeUnknownEffect(GetDefaultTeamResponse)(rawResponse).pipe(
					Effect.mapError(
						(parseError) =>
							new LinearApiError({
								message: "Unexpected response format from Linear",
								cause: parseError,
							}),
					),
				)

				// Check GraphQL errors
				if (Option.isSome(response.errors) && response.errors.value.length > 0) {
					const firstError = response.errors.value[0]?.message ?? "Unknown error"
					return yield* Effect.fail(
						new LinearApiError({
							message: parseLinearErrorMessage(firstError),
						}),
					)
				}

				const teams = Option.isSome(response.data) ? response.data.value.teams.nodes : []
				const team = teams[0]
				if (!team) {
					return yield* Effect.fail(
						new LinearTeamNotFoundError({
							message: "No teams found in your Linear workspace",
						}),
					)
				}

				return { id: team.id, name: team.name } satisfies LinearTeam
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("LinearApiClient.getDefaultTeam"),
			)

		/**
		 * Create a new Linear issue
		 */
		const createIssue = (
			accessToken: string,
			params: { title: string; description?: string; teamId?: string },
		) =>
			Effect.gen(function* () {
				const client = makeAuthenticatedClient(accessToken)

				// Get team if not provided
				const team = params.teamId
					? { id: params.teamId, name: "" }
					: yield* getDefaultTeam(accessToken)

				const rawResponse = yield* executeGraphQL(client, CREATE_ISSUE_MUTATION, {
					teamId: team.id,
					title: params.title,
					description: params.description || null,
				})

				const response = yield* Schema.decodeUnknownEffect(CreateIssueResponse)(rawResponse).pipe(
					Effect.mapError(
						(parseError) =>
							new LinearApiError({
								message: "Unexpected response format from Linear",
								cause: parseError,
							}),
					),
				)

				// Check GraphQL errors
				if (Option.isSome(response.errors) && response.errors.value.length > 0) {
					const firstError = response.errors.value[0]?.message ?? "Unknown error"
					return yield* Effect.fail(
						new LinearApiError({
							message: parseLinearErrorMessage(firstError),
						}),
					)
				}

				const issueCreate = Option.isSome(response.data) ? response.data.value.issueCreate : null
				const issue = issueCreate && Option.isSome(issueCreate.issue) ? issueCreate.issue.value : null

				if (!issueCreate?.success || !issue) {
					return yield* Effect.fail(
						new LinearApiError({
							message: "Failed to create issue",
						}),
					)
				}

				return {
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					url: issue.url,
					teamName: Option.isSome(issue.team) ? issue.team.value.name : team.name || "Linear",
				} satisfies LinearIssueCreated
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("LinearApiClient.createIssue", { attributes: { title: params.title } }),
			)

		/**
		 * Fetch a Linear issue by key (e.g., "ENG-123")
		 */
		const fetchIssue = (issueKey: string, accessToken: string) =>
			Effect.gen(function* () {
				const client = makeAuthenticatedClient(accessToken)
				const rawResponse = yield* executeGraphQL(client, ISSUE_QUERY, { issueId: issueKey })

				yield* Effect.logDebug("Linear API raw response").pipe(
					Effect.annotateLogs("rawResponse", JSON.stringify(rawResponse, null, 2)),
				)

				const response = yield* Schema.decodeUnknownEffect(GetIssueResponse)(rawResponse).pipe(
					Effect.tapError((parseError) =>
						Effect.logError("Linear API parse error").pipe(
							Effect.annotateLogs("parseError", String(parseError)),
							Effect.annotateLogs("rawResponse", JSON.stringify(rawResponse, null, 2)),
						),
					),
					Effect.mapError(
						(parseError) =>
							new LinearApiError({
								message: "Unexpected response format from Linear",
								cause: parseError,
							}),
					),
				)

				// Check GraphQL errors
				if (Option.isSome(response.errors) && response.errors.value.length > 0) {
					const firstError = response.errors.value[0]?.message ?? "Unknown error"
					const userFriendlyMessage = parseLinearErrorMessage(firstError)
					return yield* Effect.fail(new LinearApiError({ message: userFriendlyMessage }))
				}

				const issue = Option.isSome(response.data) ? response.data.value.issue : null
				if (!issue) {
					return yield* Effect.fail(new LinearIssueNotFoundError({ issueId: issueKey }))
				}

				return {
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					description: issue.description ?? null,
					url: issue.url,
					teamName: issue.team?.name ?? "Linear",
					state: issue.state
						? {
								id: issue.state.id,
								name: issue.state.name,
								color: issue.state.color,
							}
						: null,
					assignee: issue.assignee
						? {
								id: issue.assignee.id,
								name: issue.assignee.name,
								avatarUrl: issue.assignee.avatarUrl ?? null,
							}
						: null,
					priority: issue.priority ?? 0,
					priorityLabel: issue.priorityLabel ?? "No priority",
					labels: issue.labels.nodes.map((label) => ({
						id: label.id,
						name: label.name,
						color: label.color,
					})),
				} satisfies LinearIssue
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("LinearApiClient.fetchIssue", { attributes: { issueKey } }),
			)

		/**
		 * Get account info for the authenticated user (used in OAuth flow)
		 */
		const getAccountInfo = (accessToken: string) =>
			Effect.gen(function* () {
				const client = makeAuthenticatedClient(accessToken)
				const rawResponse = yield* executeGraphQL(client, VIEWER_QUERY)

				const response = yield* Schema.decodeUnknownEffect(ViewerResponse)(rawResponse).pipe(
					Effect.mapError(
						(parseError) =>
							new LinearApiError({
								message: "Unexpected response format from Linear",
								cause: parseError,
							}),
					),
				)

				// Check GraphQL errors
				if (Option.isSome(response.errors) && response.errors.value.length > 0) {
					const firstError = response.errors.value[0]?.message ?? "Unknown error"
					return yield* Effect.fail(
						new LinearApiError({
							message: parseLinearErrorMessage(firstError),
						}),
					)
				}

				if (Option.isNone(response.data)) {
					return yield* Effect.fail(
						new LinearApiError({
							message: "Failed to get Linear account info",
						}),
					)
				}

				const viewer = response.data.value.viewer

				return {
					externalAccountId: viewer.id,
					externalAccountName: viewer.organization?.name ?? viewer.name,
				} satisfies LinearAccountInfo
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("LinearApiClient.getAccountInfo"),
			)

		return {
			getDefaultTeam,
			createIssue,
			fetchIssue,
			getAccountInfo,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}
