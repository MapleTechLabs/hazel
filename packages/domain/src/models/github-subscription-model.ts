import { GitHubEventType, GitHubEventTypes } from "@hazel/integrations/github/schema"
import { ChannelId, GitHubSubscriptionId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "./utils"
import { JsonDate } from "./utils"

// Re-export from integrations for backwards compatibility
export { GitHubEventType, GitHubEventTypes }

class Model extends M.Class<Model>("GitHubSubscription")({
	id: M.Generated(GitHubSubscriptionId),
	channelId: ChannelId,
	organizationId: OrganizationId,
	// Repository identification - GitHub's numeric ID is stable across renames
	repositoryId: S.Number,
	repositoryFullName: S.String, // "owner/repo" for display
	repositoryOwner: S.String,
	repositoryName: S.String,
	// Event type filters
	enabledEvents: GitHubEventTypes,
	// Optional branch filter for push events (null = all branches)
	branchFilter: S.NullOr(S.String),
	// Whether the subscription is active
	isEnabled: S.Boolean,
	// Audit fields
	createdBy: UserId,
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(S.NullOr(JsonDate)),
	deletedAt: M.GeneratedByApp(S.NullOr(JsonDate)),
}) {}

export const { Insert, Update, Schema, Create, Patch } = M.expose(Model)
export type Type = typeof Schema.Type
