import { Workflow } from "effect/workflow"
import { Schema } from "effect"
import { CleanupUploadsWorkflowError } from "../activities/cleanup-activities.ts"

// Cleanup uploads workflow - triggered manually or by cron to clean up orphaned uploads
// Finds attachments stuck in "uploading" status for too long and marks them as failed
export const CleanupUploadsWorkflow = Workflow.make("CleanupUploadsWorkflow", {
	payload: {
		// Maximum age in minutes for uploads to be considered stale (default: 10)
		maxAgeMinutes: Schema.Number.pipe(Schema.optional),
	},
	error: CleanupUploadsWorkflowError,
	// Use timestamp-based idempotency to prevent overlapping runs
	idempotencyKey: () => `cleanup-${new Date().toISOString().slice(0, 16)}`, // Per-minute idempotency
})

export type CleanupUploadsWorkflowPayload = Schema.Schema.Type<typeof CleanupUploadsWorkflow.payloadSchema>
