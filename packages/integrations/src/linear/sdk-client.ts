/**
 * Linear SDK Client
 *
 * Effect-based wrapper around the official @linear/sdk client.
 * Provides strongly typed methods for listing, searching, and updating issues.
 */

import {
	LinearClient,
	LinearError,
	InvalidInputLinearError,
	type IssueConnection,
	type IssueSearchResult,
} from "@linear/sdk"
import { Effect } from "effect"
import {
	LinearApiError,
	LinearRateLimitError,
	LinearIssueNotFoundError,
	type LinearIssue,
	type LinearTeam,
} from "./api-client.ts"

// ============================================================================
// Error Mapping
// ============================================================================

/**
 * Map Linear SDK errors to our existing Effect Schema error types.
 * Does not return LinearIssueNotFoundError - that should be handled explicitly by callers.
 */
const mapLinearError = (error: unknown): LinearApiError | LinearRateLimitError => {
	if (error instanceof InvalidInputLinearError) {
		return new LinearApiError({
			message: error.message,
			status: error.status,
			cause: { query: error.query, variables: error.variables, data: error.data },
		})
	}
	if (error instanceof LinearError) {
		// Check for rate limiting (status 429)
		if (error.status === 429) {
			return new LinearRateLimitError({
				message: "Rate limit exceeded, try again later",
				retryAfter: undefined,
			})
		}
		return new LinearApiError({
			message: error.message,
			status: error.status,
			cause: { query: error.query, variables: error.variables, data: error.data },
		})
	}
	return new LinearApiError({ message: String(error) })
}

// ============================================================================
// Types
// ============================================================================

export interface ListIssuesOptions {
	teamId?: string
	stateType?: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
	assigneeId?: string
	priority?: number
	first?: number
	after?: string
}

export interface SearchIssuesOptions {
	first?: number
	after?: string
	includeArchived?: boolean
}

export interface ListIssuesResult {
	issues: LinearIssue[]
	pageInfo: {
		hasNextPage: boolean
		endCursor: string | null
	}
}

export interface SearchIssuesResult {
	issues: LinearIssue[]
	pageInfo: {
		hasNextPage: boolean
		endCursor: string | null
	}
}

export interface ListTeamsResult {
	teams: LinearTeam[]
}

export interface WorkflowState {
	id: string
	name: string
	color: string
	type: string
	position: number
	teamId: string
}

export interface ListWorkflowStatesResult {
	states: WorkflowState[]
}

export interface UpdateIssueInput {
	title?: string
	description?: string
	stateId?: string
	assigneeId?: string | null
	priority?: number
}

export interface UpdateIssueResult {
	success: boolean
	issue: {
		id: string
		identifier: string
		title: string
		url: string
	} | null
}

// ============================================================================
// SDK Client Factory
// ============================================================================

/**
 * Create an Effect-based Linear SDK client.
 *
 * Usage:
 * ```typescript
 * const client = makeLinearSdkClient(accessToken)
 * const result = yield* client.listIssues({ teamId: "..." })
 * ```
 */
export const makeLinearSdkClient = (accessToken: string) => {
	const client = new LinearClient({ accessToken })

	/**
	 * Map SDK issue data to our LinearIssue type
	 */
	const mapIssue = async (issue: IssueConnection["nodes"][number]): Promise<LinearIssue> => {
		const [state, assignee, labels, team] = await Promise.all([
			issue.state,
			issue.assignee,
			issue.labels(),
			issue.team,
		])

		return {
			id: issue.id,
			identifier: issue.identifier,
			title: issue.title,
			description: issue.description ?? null,
			url: issue.url,
			teamName: team?.name ?? "Linear",
			state: state
				? {
						id: state.id,
						name: state.name,
						color: state.color,
					}
				: null,
			assignee: assignee
				? {
						id: assignee.id,
						name: assignee.name,
						avatarUrl: assignee.avatarUrl ?? null,
					}
				: null,
			priority: issue.priority ?? 0,
			priorityLabel: issue.priorityLabel ?? "No priority",
			labels:
				labels?.nodes.map((label) => ({
					id: label.id,
					name: label.name,
					color: label.color,
				})) ?? [],
		}
	}

	/**
	 * Map SDK search result to our LinearIssue type.
	 * IssueSearchResult has a different shape than Issue but provides
	 * similar async getters for related entities.
	 */
	const mapSearchResult = async (result: IssueSearchResult): Promise<LinearIssue> => {
		const [state, assignee, team] = await Promise.all([result.state, result.assignee, result.team])

		return {
			id: result.id,
			identifier: result.identifier,
			title: result.title,
			description: result.description ?? null,
			url: result.url,
			teamName: team?.name ?? "Linear",
			state: state
				? {
						id: state.id,
						name: state.name,
						color: state.color,
					}
				: null,
			assignee: assignee
				? {
						id: assignee.id,
						name: assignee.name,
						avatarUrl: assignee.avatarUrl ?? null,
					}
				: null,
			priority: result.priority ?? 0,
			priorityLabel: result.priorityLabel ?? "No priority",
			labels: [], // Search results don't include labels in the basic response
		}
	}

	return {
		/**
		 * List issues with optional filters
		 */
		listIssues: (
			options: ListIssuesOptions = {},
		): Effect.Effect<ListIssuesResult, LinearApiError | LinearRateLimitError> =>
			Effect.tryPromise({
				try: async () => {
					const { teamId, stateType, assigneeId, priority, first = 25, after } = options

					// Build filter object
					const filter: Record<string, unknown> = {}
					if (teamId) filter.team = { id: { eq: teamId } }
					if (stateType) filter.state = { type: { eq: stateType } }
					if (assigneeId) filter.assignee = { id: { eq: assigneeId } }
					if (priority !== undefined) filter.priority = { eq: priority }

					const result = await client.issues({
						filter: Object.keys(filter).length > 0 ? filter : undefined,
						first: Math.min(first, 50),
						after,
					})

					const issues = await Promise.all(result.nodes.map(mapIssue))

					return {
						issues,
						pageInfo: {
							hasNextPage: result.pageInfo.hasNextPage,
							endCursor: result.pageInfo.endCursor ?? null,
						},
					}
				},
				catch: mapLinearError,
			}).pipe(Effect.withSpan("LinearSdkClient.listIssues")),

		/**
		 * Search issues by text query
		 */
		searchIssues: (
			query: string,
			options: SearchIssuesOptions = {},
		): Effect.Effect<SearchIssuesResult, LinearApiError | LinearRateLimitError> =>
			Effect.tryPromise({
				try: async () => {
					const { first = 25, after, includeArchived = false } = options

					const result = await client.searchIssues(query, {
						first: Math.min(first, 50),
						after,
						includeArchived,
					})

					const issues = await Promise.all(result.nodes.map(mapSearchResult))

					return {
						issues,
						pageInfo: {
							hasNextPage: result.pageInfo.hasNextPage,
							endCursor: result.pageInfo.endCursor ?? null,
						},
					}
				},
				catch: mapLinearError,
			}).pipe(Effect.withSpan("LinearSdkClient.searchIssues")),

		/**
		 * List all teams in workspace
		 */
		listTeams: (): Effect.Effect<ListTeamsResult, LinearApiError | LinearRateLimitError> =>
			Effect.tryPromise({
				try: async () => {
					const result = await client.teams()

					return {
						teams: result.nodes.map((team) => ({
							id: team.id,
							name: team.name,
						})),
					}
				},
				catch: mapLinearError,
			}).pipe(Effect.withSpan("LinearSdkClient.listTeams")),

		/**
		 * Get workflow states (statuses), optionally filtered by team
		 */
		getWorkflowStates: (
			teamId?: string,
		): Effect.Effect<ListWorkflowStatesResult, LinearApiError | LinearRateLimitError> =>
			Effect.tryPromise({
				try: async () => {
					const result = await client.workflowStates({
						filter: teamId ? { team: { id: { eq: teamId } } } : undefined,
					})

					const states = await Promise.all(
						result.nodes.map(async (state) => {
							const team = await state.team
							return {
								id: state.id,
								name: state.name,
								color: state.color,
								type: state.type,
								position: state.position,
								teamId: team?.id ?? "",
							}
						}),
					)

					// Sort by position within each type
					states.sort((a, b) => a.position - b.position)

					return { states }
				},
				catch: mapLinearError,
			}).pipe(Effect.withSpan("LinearSdkClient.getWorkflowStates")),

		/**
		 * Update an existing issue
		 */
		updateIssue: (
			issueId: string,
			input: UpdateIssueInput,
		): Effect.Effect<
			UpdateIssueResult,
			LinearApiError | LinearRateLimitError | LinearIssueNotFoundError
		> =>
			Effect.tryPromise({
				try: async () => {
					const issue = await client.issue(issueId)

					if (!issue) {
						throw new LinearIssueNotFoundError({ issueId })
					}

					const updatePayload: Record<string, unknown> = {}
					if (input.title !== undefined) updatePayload.title = input.title
					if (input.description !== undefined) updatePayload.description = input.description
					if (input.stateId !== undefined) updatePayload.stateId = input.stateId
					if (input.assigneeId !== undefined) updatePayload.assigneeId = input.assigneeId
					if (input.priority !== undefined) updatePayload.priority = input.priority

					const result = await issue.update(updatePayload)

					const updatedIssue = await result.issue

					return {
						success: result.success,
						issue: updatedIssue
							? {
									id: updatedIssue.id,
									identifier: updatedIssue.identifier,
									title: updatedIssue.title,
									url: updatedIssue.url,
								}
							: null,
					}
				},
				catch: (error) => {
					if (error instanceof LinearIssueNotFoundError) {
						return error
					}
					return mapLinearError(error)
				},
			}).pipe(Effect.withSpan("LinearSdkClient.updateIssue", { attributes: { issueId } })),
	}
}

export type LinearSdkClient = ReturnType<typeof makeLinearSdkClient>
