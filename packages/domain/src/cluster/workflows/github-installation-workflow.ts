import { Workflow } from "effect/workflow"
import { Schema } from "effect"
import { GitHubInstallationWorkflowError } from "../activities/github-installation-activities.ts"

/**
 * GitHub Installation Workflow - handles GitHub App lifecycle events.
 *
 * Events:
 * - `created`: Installation was created (logged only, OAuth handles setup)
 * - `deleted`: App was uninstalled - marks connection as "revoked"
 * - `suspend`: Installation was suspended - marks connection as "suspended"
 * - `unsuspend`: Installation was unsuspended - marks connection as "active"
 */
export const GitHubInstallationWorkflow = Workflow.make("GitHubInstallationWorkflow", {
	payload: {
		// GitHub delivery ID (unique per webhook delivery) - used for idempotency
		deliveryId: Schema.String,
		// Installation action type
		action: Schema.Literals(["created", "deleted", "suspend", "unsuspend"]),
		// GitHub App installation ID - used to find the connection
		installationId: Schema.Number,
		// Account where the app is installed
		accountLogin: Schema.String,
		accountType: Schema.Literals(["User", "Organization"]),
		// User who performed the action
		senderLogin: Schema.String,
	},
	error: GitHubInstallationWorkflowError,
	// Use GitHub's delivery ID for idempotency - each delivery is processed only once
	idempotencyKey: (payload) => payload.deliveryId,
})

export type GitHubInstallationWorkflowPayload = Schema.Schema.Type<
	typeof GitHubInstallationWorkflow.payloadSchema
>
