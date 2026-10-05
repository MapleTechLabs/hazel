import { Tool } from "effect/ai"
import { Schema } from "effect"

export const LinearGetAccountInfo = Tool.make("linear_get_account_info", {
	description: "Get the connected Linear account info for the current organization",
	success: Schema.Struct({
		externalAccountId: Schema.String,
		externalAccountName: Schema.String,
	}),
})

export const LinearGetDefaultTeam = Tool.make("linear_get_default_team", {
	description: "Get the default Linear team for the connected Linear account",
	success: Schema.Struct({
		team: Schema.Unknown,
	}),
})

export const LinearCreateIssue = Tool.make("linear_create_issue", {
	description: "Create a Linear issue. Use this after confirming with the user what you will create.",
	parameters: Schema.Struct({
		title: Schema.String.annotate({
			description: "Issue title (max ~80 chars recommended)",
		}),
		description: Schema.optional(
			Schema.String.annotate({ description: "Markdown description for the issue" }),
		),
		teamId: Schema.optional(
			Schema.String.annotate({
				description: "Optional team ID; if omitted, uses the user's default team",
			}),
		),
	}),
	success: Schema.Struct({ issue: Schema.Unknown }),
})

export const LinearFetchIssue = Tool.make("linear_fetch_issue", {
	description: 'Fetch a Linear issue by key (e.g. "ENG-123")',
	parameters: Schema.Struct({
		issueKey: Schema.String.annotate({ description: 'Issue key like "ENG-123"' }),
	}),
	success: Schema.Struct({ issue: Schema.Unknown }),
})

export const LinearListIssues = Tool.make("linear_list_issues", {
	description:
		"List Linear issues with optional filters (team, state, assignee, priority). Returns paginated results.",
	parameters: Schema.Struct({
		teamId: Schema.optional(Schema.String.annotate({ description: "Filter by team ID" })),
		stateType: Schema.optional(
			Schema.Literals(["triage", "backlog", "unstarted", "started", "completed", "canceled"]).annotate({
				description: "Filter by state type",
			}),
		),
		assigneeId: Schema.optional(Schema.String.annotate({ description: "Filter by assignee ID" })),
		priority: Schema.optional(
			Schema.Number.annotate({
				description: "Filter by priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)",
			}),
		),
		first: Schema.optional(
			Schema.Number.annotate({
				description: "Number of issues to return (default 25, max 50)",
			}),
		),
		after: Schema.optional(Schema.String.annotate({ description: "Pagination cursor for next page" })),
	}),
	success: Schema.Unknown,
})

export const LinearSearchIssues = Tool.make("linear_search_issues", {
	description: "Search Linear issues by text query. Searches across title, description, and comments.",
	parameters: Schema.Struct({
		query: Schema.String.annotate({ description: "Search text to find issues" }),
		first: Schema.optional(
			Schema.Number.annotate({
				description: "Number of issues to return (default 25, max 50)",
			}),
		),
		after: Schema.optional(Schema.String.annotate({ description: "Pagination cursor for next page" })),
		includeArchived: Schema.optional(
			Schema.Boolean.annotate({
				description: "Include archived issues in search (default false)",
			}),
		),
	}),
	success: Schema.Unknown,
})

export const LinearListTeams = Tool.make("linear_list_teams", {
	description: "List all teams in the connected Linear workspace",
	success: Schema.Unknown,
})

export const LinearGetWorkflowStates = Tool.make("linear_get_workflow_states", {
	description:
		"Get available workflow states (statuses) from Linear. Optionally filter by team. Use this to find valid state IDs before updating issues.",
	parameters: Schema.Struct({
		teamId: Schema.optional(Schema.String.annotate({ description: "Filter states by team ID" })),
	}),
	success: Schema.Unknown,
})

export const LinearUpdateIssue = Tool.make("linear_update_issue", {
	description:
		"Update an existing Linear issue. Use this after confirming with the user what changes to make. First use linear_get_workflow_states to get valid state IDs if changing status.",
	parameters: Schema.Struct({
		issueId: Schema.String.annotate({
			description: 'Issue identifier (e.g., "ENG-123" or UUID)',
		}),
		title: Schema.optional(Schema.String.annotate({ description: "New title for the issue" })),
		description: Schema.optional(Schema.String.annotate({ description: "New markdown description" })),
		stateId: Schema.optional(
			Schema.String.annotate({
				description: "New state/status ID (get valid IDs from linear_get_workflow_states)",
			}),
		),
		assigneeId: Schema.optional(
			Schema.NullOr(Schema.String).annotate({
				description: "New assignee ID, or null to unassign",
			}),
		),
		priority: Schema.optional(
			Schema.Number.annotate({
				description: "New priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)",
			}),
		),
	}),
	success: Schema.Unknown,
})

/** All Linear tool definitions for use in Toolkit.make() */
export const AllLinearTools = [
	LinearGetAccountInfo,
	LinearGetDefaultTeam,
	LinearCreateIssue,
	LinearFetchIssue,
	LinearListIssues,
	LinearSearchIssues,
	LinearListTeams,
	LinearGetWorkflowStates,
	LinearUpdateIssue,
] as const
