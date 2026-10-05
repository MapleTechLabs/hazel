import { AttachmentId } from "@hazel/schema"
import { Schema } from "effect"

// Stale upload info
export const StaleUpload = Schema.Struct({
	id: AttachmentId,
	fileName: Schema.String,
	uploadedAt: Schema.Date,
	ageMinutes: Schema.Number,
})

export type StaleUpload = typeof StaleUpload.Type

// Result of finding stale uploads
export const FindStaleUploadsResult = Schema.Struct({
	uploads: Schema.Array(StaleUpload),
	totalCount: Schema.Number,
})

export type FindStaleUploadsResult = typeof FindStaleUploadsResult.Type

// Result of marking uploads as failed
export const MarkUploadsFailedResult = Schema.Struct({
	markedCount: Schema.Number,
	failedIds: Schema.Array(AttachmentId),
})

export type MarkUploadsFailedResult = typeof MarkUploadsFailedResult.Type

// Error types for cleanup activities
export class FindStaleUploadsError extends Schema.TaggedError<FindStaleUploadsError>()(
	"FindStaleUploadsError",
	{
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true // Database errors are transient
}

export class MarkUploadsFailedError extends Schema.TaggedError<MarkUploadsFailedError>()(
	"MarkUploadsFailedError",
	{
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true // Database errors are transient
}

// ============================================================================
// Workflow Error Union
// ============================================================================

export const CleanupUploadsWorkflowError = Schema.Union([FindStaleUploadsError, MarkUploadsFailedError])
