/**
 * Indexes effect-orm's SQLite tables cannot declare yet: partial indexes and indexes on a JSON
 * field. `renderStoreSchema` writes them after the tables they belong to, and `DatabaseError`
 * names a violated one from its columns.
 */
export interface ExtraIndex {
	readonly name: string
	readonly table: string
	readonly unique: boolean
	/** Column names, or SQL expressions written as given. */
	readonly on: ReadonlyArray<string>
	readonly where?: string
}

const notDeleted = `"deletedAt" IS NULL`

export const extraIndexes: ReadonlyArray<ExtraIndex> = [
	{
		name: "chat_sync_link_connection_hazel_unique",
		table: "chat_sync_channel_links",
		unique: true,
		on: ["syncConnectionId", "hazelChannelId"],
		where: notDeleted,
	},
	{
		name: "chat_sync_link_connection_external_unique",
		table: "chat_sync_channel_links",
		unique: true,
		on: ["syncConnectionId", "externalChannelId"],
		where: notDeleted,
	},
	{
		name: "chat_sync_conn_org_provider_workspace_unique",
		table: "chat_sync_connections",
		unique: true,
		on: ["organizationId", "provider", "externalWorkspaceId"],
		where: notDeleted,
	},
	{
		name: "chat_sync_conn_integration_unique",
		table: "chat_sync_connections",
		unique: true,
		on: ["integrationConnectionId"],
		where: `${notDeleted} AND "integrationConnectionId" IS NOT NULL`,
	},
	{
		name: "chat_sync_msg_link_hazel_unique",
		table: "chat_sync_message_links",
		unique: true,
		on: ["channelLinkId", "hazelMessageId"],
		where: notDeleted,
	},
	{
		name: "chat_sync_msg_link_external_unique",
		table: "chat_sync_message_links",
		unique: true,
		on: ["channelLinkId", "externalMessageId"],
		where: notDeleted,
	},
	{
		name: "connect_conv_channels_channel_unique",
		table: "connect_conversation_channels",
		unique: true,
		on: ["channelId"],
		where: notDeleted,
	},
	{
		name: "connect_conv_channels_conversation_org_unique",
		table: "connect_conversation_channels",
		unique: true,
		on: ["conversationId", "organizationId"],
		where: notDeleted,
	},
	{
		name: "connect_conversations_host_channel_unique",
		table: "connect_conversations",
		unique: true,
		on: ["hostChannelId"],
		where: notDeleted,
	},
	{
		name: "connect_participants_channel_user_unique",
		table: "connect_participants",
		unique: true,
		on: ["channelId", "userId"],
		where: notDeleted,
	},
	{
		name: "custom_emojis_org_name_unique_idx",
		table: "custom_emojis",
		unique: true,
		on: ["organizationId", "name"],
		where: notDeleted,
	},
	{
		name: "github_subscriptions_channel_repo_unique",
		table: "github_subscriptions",
		unique: true,
		on: ["channelId", "repositoryId"],
		where: notDeleted,
	},
	{
		name: "int_conn_org_provider_external_user_unique",
		table: "integration_connections",
		unique: true,
		on: ["organizationId", "provider", "externalAccountId"],
		where: `${notDeleted} AND "level" = 'user' AND "externalAccountId" IS NOT NULL`,
	},
	{
		name: "int_conn_github_installation_idx",
		table: "integration_connections",
		unique: false,
		// The expression `jsonText` writes, so a query on it can use the index.
		on: [`CAST(json_extract("metadata", '$.installationId') AS TEXT)`],
	},
	{
		name: "organization_invitations_pending_email_idx",
		table: "organization_invitations",
		unique: true,
		on: ["organizationId", "email"],
		where: `"status" = 'pending'`,
	},
	{
		name: "message_outbox_events_locked_at_idx",
		table: "message_outbox_events",
		unique: false,
		on: ["lockedAt"],
		where: `"status" = 'processing'`,
	},
	{
		name: "notifications_message_channel_dedupe_idx",
		table: "notifications",
		unique: true,
		on: ["memberId", "resourceId", "targetedResourceId"],
		where: `"resourceType" = 'message' AND "targetedResourceType" = 'channel'`,
	},
	{
		name: "organizations_clerk_org_id_unique",
		table: "organizations",
		unique: true,
		on: [`CAST(json_extract("settings", '$.clerkOrganizationId') AS TEXT)`],
		where: `${notDeleted} AND json_extract("settings", '$.clerkOrganizationId') IS NOT NULL`,
	},
	{
		name: "rss_subscriptions_channel_feed_unique",
		table: "rss_subscriptions",
		unique: true,
		on: ["channelId", "feedUrl"],
		where: notDeleted,
	},
]

const PLAIN_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `CREATE [UNIQUE] INDEX IF NOT EXISTS ...` for one extra index. */
export const renderExtraIndex = (index: ExtraIndex): string =>
	`CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS "${index.name}" ON "${index.table}" (${index.on
		.map((on) => (PLAIN_COLUMN.test(on) ? `"${on}"` : on))
		.join(", ")})${index.where === undefined ? "" : ` WHERE ${index.where}`}`
