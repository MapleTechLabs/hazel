import {
	ChannelId,
	IntegrationConnectionId,
	MessageId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	SyncEventReceiptId,
	SyncMessageLinkId,
	UserId,
} from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const chatSyncConnectionStatusEnum = textEnum(["active", "paused", "error", "disabled"])
export const chatSyncDirectionEnum = textEnum(["both", "hazel_to_external", "external_to_hazel"])
export const chatSyncReceiptSourceEnum = textEnum(["hazel", "external"])
export const chatSyncReceiptStatusEnum = textEnum(["processed", "ignored", "failed"])

export const chatSyncChannelLinksTable = SQLite.table("chat_sync_channel_links", {
	columns: {
		id: SQLite.column(uuid(SyncChannelLinkId), { defaultExpr: randomUuid }),
		syncConnectionId: uuid(SyncConnectionId),
		hazelChannelId: uuid(ChannelId),
		externalChannelId: varchar(255),
		externalChannelName: SQLite.nullable(varchar(255)),
		direction: SQLite.column(chatSyncDirectionEnum, { default: "both" }),
		isActive: SQLite.column(SQLite.boolean, { default: true }),
		settings: SQLite.nullable(jsonb<Record<string, any>>()),
		lastSyncedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("chat_sync_link_connection_idx", ["syncConnectionId"]),
		SQLite.index("chat_sync_link_hazel_channel_idx", ["hazelChannelId"]),
		SQLite.index("chat_sync_link_external_channel_idx", ["externalChannelId"]),
		SQLite.index("chat_sync_link_deleted_at_idx", ["deletedAt"]),
	],
})
export type ChatSyncChannelLink = SQLite.SelectRowOf<typeof chatSyncChannelLinksTable>
export type NewChatSyncChannelLink = SQLite.InsertRowOf<typeof chatSyncChannelLinksTable>

export const chatSyncConnectionsTable = SQLite.table("chat_sync_connections", {
	columns: {
		id: SQLite.column(uuid(SyncConnectionId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		integrationConnectionId: SQLite.nullable(uuid(IntegrationConnectionId)),
		provider: varchar(50),
		externalWorkspaceId: varchar(255),
		externalWorkspaceName: SQLite.nullable(varchar(255)),
		status: SQLite.column(chatSyncConnectionStatusEnum, { default: "active" }),
		settings: SQLite.nullable(jsonb<Record<string, any>>()),
		metadata: SQLite.nullable(jsonb<Record<string, any>>()),
		errorMessage: SQLite.nullable(SQLite.text),
		lastSyncedAt: SQLite.nullable(timestamptz),
		createdBy: uuid(UserId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("chat_sync_conn_org_idx", ["organizationId"]),
		SQLite.index("chat_sync_conn_integration_idx", ["integrationConnectionId"]),
		SQLite.index("chat_sync_conn_provider_idx", ["provider"]),
		SQLite.index("chat_sync_conn_status_idx", ["status"]),
		SQLite.index("chat_sync_conn_deleted_at_idx", ["deletedAt"]),
	],
})
export type ChatSyncConnection = SQLite.SelectRowOf<typeof chatSyncConnectionsTable>
export type NewChatSyncConnection = SQLite.InsertRowOf<typeof chatSyncConnectionsTable>

export const chatSyncEventReceiptsTable = SQLite.table("chat_sync_event_receipts", {
	columns: {
		id: SQLite.column(uuid(SyncEventReceiptId), { defaultExpr: randomUuid }),
		syncConnectionId: uuid(SyncConnectionId),
		channelLinkId: SQLite.nullable(uuid(SyncChannelLinkId)),
		source: chatSyncReceiptSourceEnum,
		externalEventId: SQLite.nullable(varchar(255)),
		dedupeKey: varchar(255),
		payloadHash: SQLite.nullable(varchar(128)),
		status: SQLite.column(chatSyncReceiptStatusEnum, { default: "processed" }),
		errorMessage: SQLite.nullable(SQLite.text),
		processedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("chat_sync_receipt_connection_idx", ["syncConnectionId"]),
		SQLite.index("chat_sync_receipt_channel_link_idx", ["channelLinkId"]),
		SQLite.index("chat_sync_receipt_source_idx", ["source"]),
		SQLite.index("chat_sync_receipt_processed_at_idx", ["processedAt"]),
		SQLite.uniqueIndex("chat_sync_receipt_dedupe_unique", ["syncConnectionId", "source", "dedupeKey"]),
	],
})
export type ChatSyncEventReceipt = SQLite.SelectRowOf<typeof chatSyncEventReceiptsTable>
export type NewChatSyncEventReceipt = SQLite.InsertRowOf<typeof chatSyncEventReceiptsTable>

export const chatSyncMessageLinksTable = SQLite.table("chat_sync_message_links", {
	columns: {
		id: SQLite.column(uuid(SyncMessageLinkId), { defaultExpr: randomUuid }),
		channelLinkId: uuid(SyncChannelLinkId),
		hazelMessageId: uuid(MessageId),
		externalMessageId: varchar(255),
		source: SQLite.column(chatSyncReceiptSourceEnum, { default: "hazel" }),
		rootHazelMessageId: SQLite.nullable(uuid(MessageId)),
		rootExternalMessageId: SQLite.nullable(varchar(255)),
		hazelThreadChannelId: SQLite.nullable(uuid(ChannelId)),
		externalThreadId: SQLite.nullable(varchar(255)),
		lastSyncedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("chat_sync_msg_link_channel_idx", ["channelLinkId"]),
		SQLite.index("chat_sync_msg_link_hazel_message_idx", ["hazelMessageId"]),
		SQLite.index("chat_sync_msg_link_external_message_idx", ["externalMessageId"]),
		SQLite.index("chat_sync_msg_link_root_hazel_idx", ["rootHazelMessageId"]),
		SQLite.index("chat_sync_msg_link_deleted_at_idx", ["deletedAt"]),
	],
})
export type ChatSyncMessageLink = SQLite.SelectRowOf<typeof chatSyncMessageLinksTable>
export type NewChatSyncMessageLink = SQLite.InsertRowOf<typeof chatSyncMessageLinksTable>

export type ChatSyncOutboundIdentitySettings = {
	readonly enabled: boolean
	readonly strategy: "webhook" | "fallback_bot"
	readonly providers: Record<string, Record<string, unknown>>
}
