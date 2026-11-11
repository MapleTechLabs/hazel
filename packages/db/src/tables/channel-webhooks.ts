import { ChannelId, ChannelWebhookId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const channelWebhooksTable = SQLite.table("channel_webhooks", {
	columns: {
		id: SQLite.column(uuid(ChannelWebhookId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		botUserId: uuid(UserId),
		name: varchar(100),
		description: SQLite.nullable(SQLite.text),
		avatarUrl: SQLite.nullable(SQLite.text),
		tokenHash: SQLite.text,
		tokenSuffix: varchar(4),
		isEnabled: SQLite.column(SQLite.boolean, { default: true }),
		createdBy: uuid(UserId),
		lastUsedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("channel_webhooks_channel_id_idx", ["channelId"]),
		SQLite.index("channel_webhooks_organization_id_idx", ["organizationId"]),
		SQLite.index("channel_webhooks_bot_user_id_idx", ["botUserId"]),
		SQLite.index("channel_webhooks_token_hash_idx", ["tokenHash"]),
		SQLite.index("channel_webhooks_deleted_at_idx", ["deletedAt"]),
	],
})
export type ChannelWebhook = SQLite.SelectRowOf<typeof channelWebhooksTable>
export type NewChannelWebhook = SQLite.InsertRowOf<typeof channelWebhooksTable>
