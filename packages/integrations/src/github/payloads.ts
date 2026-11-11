import { Schema } from "effect"

/**
 * Typed schemas for GitHub webhook payloads.
 * Used for type-safe processing in the webhook handler.
 */

// Common schemas
export const GitHubUser = Schema.Struct({
	login: Schema.String,
	avatar_url: Schema.optional(Schema.String),
	html_url: Schema.optional(Schema.String),
})

export const GitHubRepository = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	full_name: Schema.String,
	html_url: Schema.optional(Schema.String),
	stargazers_count: Schema.optional(Schema.Number),
	description: Schema.optional(Schema.NullOr(Schema.String)),
	language: Schema.optional(Schema.NullOr(Schema.String)),
	forks_count: Schema.optional(Schema.Number),
	open_issues_count: Schema.optional(Schema.Number),
})

export const GitHubLabel = Schema.Struct({
	name: Schema.String,
	color: Schema.String,
})

// Push event
export const GitHubCommit = Schema.Struct({
	id: Schema.String,
	message: Schema.String,
	url: Schema.optional(Schema.String),
	author: Schema.optional(
		Schema.Struct({
			name: Schema.String,
			email: Schema.String,
		}),
	),
})

export const GitHubPushPayload = Schema.Struct({
	ref: Schema.String,
	before: Schema.optional(Schema.String),
	after: Schema.optional(Schema.String),
	compare: Schema.optional(Schema.String),
	commits: Schema.optional(Schema.Array(GitHubCommit)),
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubPushPayload = Schema.Schema.Type<typeof GitHubPushPayload>

// Pull request event
export const GitHubPullRequest = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.String,
	draft: Schema.optional(Schema.Boolean),
	merged: Schema.optional(Schema.Boolean),
	html_url: Schema.String,
	additions: Schema.optional(Schema.Number),
	deletions: Schema.optional(Schema.Number),
	labels: Schema.optional(Schema.Array(GitHubLabel)),
	user: Schema.optional(GitHubUser),
})

export const GitHubPullRequestPayload = Schema.Struct({
	action: Schema.String,
	pull_request: GitHubPullRequest,
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubPullRequestPayload = Schema.Schema.Type<typeof GitHubPullRequestPayload>

// Issue event
export const GitHubIssue = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.String,
	html_url: Schema.String,
	labels: Schema.optional(Schema.Array(GitHubLabel)),
	user: Schema.optional(GitHubUser),
})

export const GitHubIssuesPayload = Schema.Struct({
	action: Schema.String,
	issue: GitHubIssue,
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubIssuesPayload = Schema.Schema.Type<typeof GitHubIssuesPayload>

// Release event
export const GitHubRelease = Schema.Struct({
	tag_name: Schema.String,
	name: Schema.NullOr(Schema.String),
	body: Schema.NullOr(Schema.String),
	html_url: Schema.String,
	prerelease: Schema.optional(Schema.Boolean),
	draft: Schema.optional(Schema.Boolean),
})

export const GitHubReleasePayload = Schema.Struct({
	action: Schema.String,
	release: GitHubRelease,
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubReleasePayload = Schema.Schema.Type<typeof GitHubReleasePayload>

// Deployment status event
export const GitHubDeployment = Schema.Struct({
	environment: Schema.String,
	url: Schema.optional(Schema.String),
})

export const GitHubDeploymentStatus = Schema.Struct({
	state: Schema.String,
	description: Schema.NullOr(Schema.String),
	target_url: Schema.NullOr(Schema.String),
})

export const GitHubDeploymentStatusPayload = Schema.Struct({
	deployment: GitHubDeployment,
	deployment_status: GitHubDeploymentStatus,
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubDeploymentStatusPayload = Schema.Schema.Type<typeof GitHubDeploymentStatusPayload>

// Workflow run event
export const GitHubWorkflowRun = Schema.Struct({
	name: Schema.String,
	run_number: Schema.Number,
	status: Schema.String,
	conclusion: Schema.NullOr(Schema.String),
	html_url: Schema.String,
	head_branch: Schema.optional(Schema.String),
	run_started_at: Schema.NullOr(Schema.String),
	updated_at: Schema.optional(Schema.String),
})

export const GitHubWorkflowRunPayload = Schema.Struct({
	action: Schema.String,
	workflow_run: GitHubWorkflowRun,
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubWorkflowRunPayload = Schema.Schema.Type<typeof GitHubWorkflowRunPayload>

// Star event
export const GitHubStarPayload = Schema.Struct({
	action: Schema.String, // "created" or "deleted"
	starred_at: Schema.NullOr(Schema.String),
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubStarPayload = Schema.Schema.Type<typeof GitHubStarPayload>

// Milestone event
export const GitHubMilestone = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	state: Schema.String,
	due_on: Schema.NullOr(Schema.String),
	open_issues: Schema.Number,
	closed_issues: Schema.Number,
	html_url: Schema.String,
	creator: Schema.optional(GitHubUser),
})

export const GitHubMilestonePayload = Schema.Struct({
	action: Schema.String, // "created" | "opened" | "closed" | "edited" | "deleted"
	milestone: GitHubMilestone,
	repository: GitHubRepository,
	sender: Schema.optional(GitHubUser),
})

export type GitHubMilestonePayload = Schema.Schema.Type<typeof GitHubMilestonePayload>

/**
 * Union of all GitHub webhook payload types.
 */
export type GitHubWebhookPayload =
	| GitHubPushPayload
	| GitHubPullRequestPayload
	| GitHubIssuesPayload
	| GitHubReleasePayload
	| GitHubDeploymentStatusPayload
	| GitHubWorkflowRunPayload
	| GitHubStarPayload
	| GitHubMilestonePayload

/**
 * GitHub event types supported by the integration.
 */
export const GitHubEventType = Schema.Literals([
	"push",
	"pull_request",
	"issues",
	"release",
	"deployment_status",
	"workflow_run",
	"star",
	"milestone",
])
export type GitHubEventType = Schema.Schema.Type<typeof GitHubEventType>

export const GitHubEventTypes = Schema.Array(GitHubEventType)
export type GitHubEventTypes = Schema.Schema.Type<typeof GitHubEventTypes>
