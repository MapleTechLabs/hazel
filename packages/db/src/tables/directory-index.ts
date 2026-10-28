/**
 * The directory's routing indexes (D1): which object owns an organization, a membership, a
 * channel, a webhook, an integration or a chat-sync link. Each row is written by the owning
 * object's outbox; the api Worker reads them to route a request.
 */
import { ChannelId, ChannelWebhookId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid } from "./columns"

export const orgIndexTable = SQLite.table("org_index", {
	columns: {
		id: uuid(OrganizationId),
		slug: SQLite.nullable(SQLite.text),
		name: SQLite.text,
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("org_index_slug_idx", ["slug"])],
})
export type OrgIndex = SQLite.SelectRowOf<typeof orgIndexTable>

export const membershipIndexTable = SQLite.table("membership_index", {
	columns: {
		userId: uuid(UserId),
		organizationId: uuid(OrganizationId),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["userId", "organizationId"],
	indexes: [SQLite.index("membership_index_organization_id_idx", ["organizationId"])],
})
export type MembershipIndex = SQLite.SelectRowOf<typeof membershipIndexTable>

export const channelIndexTable = SQLite.table("channel_index", {
	columns: {
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		/** For a Connect channel mounted in a guest org: the host channel holding its messages. */
		hostChannelId: SQLite.nullable(uuid(ChannelId)),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["channelId"],
	indexes: [
		SQLite.index("channel_index_organization_id_idx", ["organizationId"]),
		SQLite.index("channel_index_host_channel_id_idx", ["hostChannelId"]),
	],
})
export type ChannelIndex = SQLite.SelectRowOf<typeof channelIndexTable>

export const webhookIndexTable = SQLite.table("webhook_index", {
	columns: {
		webhookId: uuid(ChannelWebhookId),
		organizationId: uuid(OrganizationId),
		channelId: uuid(ChannelId),
		tokenHash: SQLite.text,
	},
	primaryKey: ["webhookId"],
	indexes: [SQLite.uniqueIndex("webhook_index_token_hash_unique", ["tokenHash"])],
})
export type WebhookIndex = SQLite.SelectRowOf<typeof webhookIndexTable>

export const integrationIndexTable = SQLite.table("integration_index", {
	columns: {
		provider: SQLite.text,
		/** The provider's id for the installation (a GitHub installation id, say). */
		externalId: SQLite.text,
		organizationId: uuid(OrganizationId),
	},
	primaryKey: ["provider", "externalId"],
	indexes: [SQLite.index("integration_index_organization_id_idx", ["organizationId"])],
})
export type IntegrationIndex = SQLite.SelectRowOf<typeof integrationIndexTable>

export const chatSyncIndexTable = SQLite.table("chat_sync_index", {
	columns: {
		id: SQLite.column(SQLite.text, { defaultExpr: randomUuid }),
		provider: SQLite.text,
		externalWorkspaceId: SQLite.text,
		/** Null for a workspace-level row (the connection itself). */
		externalChannelId: SQLite.nullable(SQLite.text),
		organizationId: uuid(OrganizationId),
		channelId: SQLite.nullable(uuid(ChannelId)),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("chat_sync_index_external_unique", [
			"provider",
			"externalWorkspaceId",
			"externalChannelId",
		]),
		SQLite.index("chat_sync_index_organization_id_idx", ["organizationId"]),
	],
})
export type ChatSyncIndex = SQLite.SelectRowOf<typeof chatSyncIndexTable>
