/**
 * Linear Resource Provider - Re-exports from shared package
 *
 * This file re-exports the shared Linear API client from @hazel/integrations
 * for backwards compatibility with existing backend code.
 */

import { Linear } from "@hazel/integrations"
import { Effect } from "effect"

// ============ Re-export from shared package ============

export {
	// Error Types
	LinearApiError,
	LinearIssueNotFoundError,
	LinearRateLimitError,
	// URL Utilities
	parseLinearIssueUrl,
} from "@hazel/integrations/linear"

// ============ Convenience Function ============

/**
 * Fetch a Linear issue by its key using the shared client.
 */
export const fetchLinearIssue = (issueKey: string, accessToken: string) =>
	Effect.gen(function* () {
		const client = yield* Linear.LinearApiClient
		return yield* client.fetchIssue(issueKey, accessToken)
	}).pipe(Effect.provide(Linear.LinearApiClient.layer))
