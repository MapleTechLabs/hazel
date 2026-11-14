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
