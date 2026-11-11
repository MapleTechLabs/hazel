/**
 * Test payload fixtures for GitHub webhook embeds.
 * Used by demo pages and tests to ensure embed previews match production.
 */
import type {
	GitHubDeploymentStatusPayload,
	GitHubIssuesPayload,
	GitHubMilestonePayload,
	GitHubPullRequestPayload,
	GitHubPushPayload,
	GitHubReleasePayload,
	GitHubStarPayload,
	GitHubWorkflowRunPayload,
} from "../payloads.ts"

// Base user fixture
const baseUser = {
	login: "octocat",
	avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
	html_url: "https://github.com/octocat",
}

// Base repository fixture
const baseRepo = {
	id: 1,
	name: "hello-world",
	full_name: "octocat/hello-world",
	html_url: "https://github.com/octocat/hello-world",
}

// Extended repo with star info
const starRepo = {
	...baseRepo,
	stargazers_count: 1234,
	forks_count: 567,
	language: "TypeScript",
	description: "A sample repository for testing",
}

/**
 * Test payloads for all GitHub event types.
 */
export const testPayloads = {
	// Push events
	push_single: {
		ref: "refs/heads/main",
		compare: "https://github.com/octocat/hello-world/compare/abc...def",
		commits: [
			{
				id: "abc1234567890",
				message: "feat: add new feature",
			},
		],
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPushPayload,

	push_multiple: {
		ref: "refs/heads/feature/new-api",
		compare: "https://github.com/octocat/hello-world/compare/abc...xyz",
		commits: [
			{ id: "abc1234567890", message: "feat: add user authentication" },
			{ id: "def2345678901", message: "feat: add API endpoints" },
			{ id: "ghi3456789012", message: "test: add unit tests" },
		],
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPushPayload,

	push_branch_created: {
		ref: "refs/heads/feature/new-api",
		before: "0000000000000000000000000000000000000000",
		after: "abc1234567890",
		commits: [],
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPushPayload,

	push_tag_created: {
		ref: "refs/tags/v1.0.0",
		before: "0000000000000000000000000000000000000000",
		after: "abc1234567890",
		commits: [],
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPushPayload,

	// Pull request events
	pr_opened: {
		action: "opened",
		pull_request: {
			number: 42,
			title: "Add user authentication",
			body: "This PR adds user authentication using OAuth 2.0. It includes login, logout, and session management.",
			state: "open",
			draft: false,
			html_url: "https://github.com/octocat/hello-world/pull/42",
			additions: 234,
			deletions: 56,
			labels: [
				{ name: "enhancement", color: "a2eeef" },
				{ name: "auth", color: "0075ca" },
			],
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPullRequestPayload,

	pr_merged: {
		action: "closed",
		pull_request: {
			number: 41,
			title: "Fix database connection pooling",
			body: "Resolved the connection leak issue that caused timeouts under high load.",
			state: "closed",
			merged: true,
			html_url: "https://github.com/octocat/hello-world/pull/41",
			additions: 89,
			deletions: 23,
			labels: [{ name: "bug", color: "d73a4a" }],
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPullRequestPayload,

	pr_closed: {
		action: "closed",
		pull_request: {
			number: 40,
			title: "Experimental feature X",
			body: "Closing this as we decided to go a different direction.",
			state: "closed",
			merged: false,
			html_url: "https://github.com/octocat/hello-world/pull/40",
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPullRequestPayload,

	pr_draft: {
		action: "opened",
		pull_request: {
			number: 43,
			title: "[WIP] Refactor payment system",
			body: "Work in progress - refactoring the payment processing module.",
			state: "open",
			draft: true,
			html_url: "https://github.com/octocat/hello-world/pull/43",
			additions: 456,
			deletions: 123,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubPullRequestPayload,

	// Issue events
	issue_opened: {
		action: "opened",
		issue: {
			number: 123,
			title: "Button not responding on mobile",
			body: "The submit button doesn't work on iOS Safari. Tested on iPhone 14.",
			state: "open",
			html_url: "https://github.com/octocat/hello-world/issues/123",
			labels: [
				{ name: "bug", color: "d73a4a" },
				{ name: "mobile", color: "c5def5" },
			],
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubIssuesPayload,

	issue_closed: {
		action: "closed",
		issue: {
			number: 120,
			title: "Add dark mode support",
			body: "Users have requested dark mode for the application.",
			state: "closed",
			html_url: "https://github.com/octocat/hello-world/issues/120",
			labels: [{ name: "enhancement", color: "a2eeef" }],
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubIssuesPayload,

	// Release events
	release_published: {
		action: "published",
		release: {
			tag_name: "v2.0.0",
			name: "Version 2.0.0",
			body: "## What's New\n- User authentication\n- Dark mode\n- Performance improvements",
			html_url: "https://github.com/octocat/hello-world/releases/tag/v2.0.0",
			prerelease: false,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubReleasePayload,

	release_prerelease: {
		action: "published",
		release: {
			tag_name: "v2.1.0-beta.1",
			name: "Version 2.1.0 Beta 1",
			body: "Beta release for testing new features.",
			html_url: "https://github.com/octocat/hello-world/releases/tag/v2.1.0-beta.1",
			prerelease: true,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubReleasePayload,

	// Deployment events
	deployment_success: {
		deployment: {
			environment: "production",
			url: "https://api.github.com/repos/octocat/hello-world/deployments/1",
		},
		deployment_status: {
			state: "success",
			description: "Deployment completed successfully",
			target_url: "https://hello-world.example.com",
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubDeploymentStatusPayload,

	deployment_failure: {
		deployment: {
			environment: "staging",
			url: "https://api.github.com/repos/octocat/hello-world/deployments/2",
		},
		deployment_status: {
			state: "failure",
			description: "Deployment failed: health check timeout",
			target_url: null,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubDeploymentStatusPayload,

	deployment_pending: {
		deployment: {
			environment: "preview",
			url: "https://api.github.com/repos/octocat/hello-world/deployments/3",
		},
		deployment_status: {
			state: "pending",
			description: "Waiting for approval",
			target_url: null,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubDeploymentStatusPayload,

	// Workflow run events
	workflow_success: {
		action: "completed",
		workflow_run: {
			name: "CI",
			run_number: 456,
			status: "completed",
			conclusion: "success",
			html_url: "https://github.com/octocat/hello-world/actions/runs/456",
			head_branch: "main",
			run_started_at: new Date(Date.now() - 154000).toISOString(), // ~2m 34s ago
			updated_at: new Date().toISOString(),
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubWorkflowRunPayload,

	workflow_failure: {
		action: "completed",
		workflow_run: {
			name: "Tests",
			run_number: 455,
			status: "completed",
			conclusion: "failure",
			html_url: "https://github.com/octocat/hello-world/actions/runs/455",
			head_branch: "feature/new-api",
			run_started_at: new Date(Date.now() - 45000).toISOString(), // ~45s ago
			updated_at: new Date().toISOString(),
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubWorkflowRunPayload,

	workflow_cancelled: {
		action: "completed",
		workflow_run: {
			name: "Deploy",
			run_number: 454,
			status: "completed",
			conclusion: "cancelled",
			html_url: "https://github.com/octocat/hello-world/actions/runs/454",
			head_branch: "main",
			run_started_at: new Date(Date.now() - 12000).toISOString(),
			updated_at: new Date().toISOString(),
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubWorkflowRunPayload,

	// Star events
	star_created: {
		action: "created",
		starred_at: new Date().toISOString(),
		repository: starRepo,
		sender: baseUser,
	} satisfies GitHubStarPayload,

	star_deleted: {
		action: "deleted",
		starred_at: null,
		repository: starRepo,
		sender: baseUser,
	} satisfies GitHubStarPayload,

	// Milestone events
	milestone_created: {
		action: "created",
		milestone: {
			number: 1,
			title: "Version 2.0",
			description: "Major release with new features and improvements",
			state: "open",
			due_on: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
			open_issues: 8,
			closed_issues: 4,
			html_url: "https://github.com/octocat/hello-world/milestone/1",
			creator: baseUser,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubMilestonePayload,

	milestone_closed: {
		action: "closed",
		milestone: {
			number: 1,
			title: "Version 1.5",
			description: "Bug fixes and performance improvements",
			state: "closed",
			due_on: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
			open_issues: 0,
			closed_issues: 12,
			html_url: "https://github.com/octocat/hello-world/milestone/1",
			creator: baseUser,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubMilestonePayload,

	milestone_overdue: {
		action: "edited",
		milestone: {
			number: 2,
			title: "Q4 Release",
			description: "Quarterly release milestone",
			state: "open",
			due_on: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago (overdue)
			open_issues: 5,
			closed_issues: 10,
			html_url: "https://github.com/octocat/hello-world/milestone/2",
			creator: baseUser,
		},
		repository: baseRepo,
		sender: baseUser,
	} satisfies GitHubMilestonePayload,
}
