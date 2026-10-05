import { IntegrationConnectionId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { IntegrationConnection } from "../../models"

// Result of finding connections by installation ID
export const FindConnectionByInstallationResult = Schema.Struct({
	connections: Schema.Array(
		Schema.Struct({
			id: IntegrationConnectionId,
			organizationId: OrganizationId,
			status: IntegrationConnection.ConnectionStatus,
			externalAccountName: Schema.NullOr(Schema.String),
		}),
	),
	totalCount: Schema.Number,
})

export type FindConnectionByInstallationResult = Schema.Schema.Type<typeof FindConnectionByInstallationResult>

// Result of updating connection status
export const UpdateConnectionStatusResult = Schema.Struct({
	updatedCount: Schema.Number,
	connectionIds: Schema.Array(IntegrationConnectionId),
	newStatus: IntegrationConnection.ConnectionStatus,
})

export type UpdateConnectionStatusResult = Schema.Schema.Type<typeof UpdateConnectionStatusResult>

// Error types for installation activities
export class FindConnectionByInstallationError extends Schema.TaggedError<FindConnectionByInstallationError>()(
	"FindConnectionByInstallationError",
	{
		installationId: Schema.Number,
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true // Database errors are transient
}

export class UpdateConnectionStatusError extends Schema.TaggedError<UpdateConnectionStatusError>()(
	"UpdateConnectionStatusError",
	{
		installationId: Schema.Number,
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true // Database errors are transient
}

// ============================================================================
// Workflow Error Union
// ============================================================================

export const GitHubInstallationWorkflowError = Schema.Union([
	FindConnectionByInstallationError,
	UpdateConnectionStatusError,
])
