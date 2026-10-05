import { Workflow } from "effect/workflow"
import { Schema } from "effect"
import { GitHubWebhookWorkflowError } from "../activities/github-activities.ts"

// GitHub webhook workflow - triggered when a GitHub webhook event is received
// Processes the event and creates messages in subscribed channels
export const GitHubWebhookWorkflow = Workflow.make("GitHubWebhookWorkflow", {
	payload: {
		// GitHub delivery ID (unique per webhook delivery) - used for idempotency
		deliveryId: Schema.String,
		// GitHub event type (push, pull_request, issues, release, deployment_status, workflow_run)
		eventType: Schema.String,
		// GitHub App installation ID - used to find the organization
		installationId: Schema.Number,
		// Repository identification
		repositoryId: Schema.Number,
		repositoryFullName: Schema.String,
		// Full GitHub event payload (varies by event type)
		eventPayload: Schema.Unknown,
	},
	error: GitHubWebhookWorkflowError,
	// Use GitHub's delivery ID for idempotency - each delivery is processed only once
	idempotencyKey: (payload) => payload.deliveryId,
})

export type GitHubWebhookWorkflowPayload = Schema.Schema.Type<typeof GitHubWebhookWorkflow.payloadSchema>
