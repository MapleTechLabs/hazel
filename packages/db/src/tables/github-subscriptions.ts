import type { GitHubSubscription as GitHubSubscriptionModel } from "@hazel/domain/models"
import { ChannelId, GitHubSubscriptionId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, timestamptz, uuid, varchar } from "./columns"

type GitHubEventType = GitHubSubscriptionModel.GitHubEventType

export const githubSubscriptionsTable = SQLite.table("github_subscriptions", {
	columns: {
		id: SQLite.column(uuid(GitHubSubscriptionId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		repositoryId: SQLite.integer,
		repositoryFullName: varchar(255),
		repositoryOwner: varchar(255),
		repositoryName: varchar(255),
		enabledEvents: SQLite.column(jsonb<GitHubEventType[]>(), {
			default: ["push", "pull_request", "issues"],
		}),
		branchFilter: SQLite.nullable(varchar(255)),
		isEnabled: SQLite.column(SQLite.boolean, { default: true }),
		createdBy: uuid(UserId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("github_subscriptions_channel_id_idx", ["channelId"]),
		SQLite.index("github_subscriptions_organization_id_idx", ["organizationId"]),
		SQLite.index("github_subscriptions_repository_id_idx", ["repositoryId"]),
		SQLite.index("github_subscriptions_deleted_at_idx", ["deletedAt"]),
	],
})
export type GitHubSubscription = SQLite.SelectRowOf<typeof githubSubscriptionsTable>
export type NewGitHubSubscription = SQLite.InsertRowOf<typeof githubSubscriptionsTable>
