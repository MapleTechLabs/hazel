/**
 * Linear Integration Package
 *
 * Provides Effect-based HTTP client for Linear GraphQL API.
 */

export {
	// Service
	LinearApiClient,
	// Domain Schemas
	LinearIssue,
	LinearIssueState,
	LinearIssueAssignee,
	LinearIssueLabel,
	LinearTeam,
	LinearIssueCreated,
	LinearAccountInfo,
	// Error Types
	LinearApiError,
	LinearRateLimitError,
	LinearIssueNotFoundError,
	LinearTeamNotFoundError,
	// URL Utilities
	parseLinearIssueUrl,
	isLinearIssueUrl,
	extractLinearUrls,
} from "./api-client.ts"

// SDK Client (uses official @linear/sdk)
export {
	makeLinearSdkClient,
	type LinearSdkClient,
	type ListIssuesOptions,
	type ListIssuesResult,
	type SearchIssuesOptions,
	type SearchIssuesResult,
	type ListTeamsResult,
	type WorkflowState,
	type ListWorkflowStatesResult,
	type UpdateIssueInput,
	type UpdateIssueResult,
} from "./sdk-client.ts"
