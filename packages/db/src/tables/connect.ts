import {
	ChannelId,
	ConnectConversationChannelId,
	ConnectConversationId,
	ConnectInviteId,
	ConnectParticipantId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const connectConversationStatusEnum = textEnum(["active", "disconnected"])
export const connectConversationChannelRoleEnum = textEnum(["host", "guest"])
export const connectInviteStatusEnum = textEnum(["pending", "accepted", "declined", "revoked", "expired"])
export const connectInviteTargetKindEnum = textEnum(["slug", "email"])

export const connectConversationChannelsTable = SQLite.table("connect_conversation_channels", {
	columns: {
		id: SQLite.column(uuid(ConnectConversationChannelId), { defaultExpr: randomUuid }),
		conversationId: uuid(ConnectConversationId),
		organizationId: uuid(OrganizationId),
		channelId: uuid(ChannelId),
		role: connectConversationChannelRoleEnum,
		allowGuestMemberAdds: SQLite.column(SQLite.boolean, { default: false }),
		isActive: SQLite.column(SQLite.boolean, { default: true }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("connect_conv_channels_conversation_idx", ["conversationId"]),
		SQLite.index("connect_conv_channels_org_idx", ["organizationId"]),
		SQLite.index("connect_conv_channels_channel_idx", ["channelId"]),
		SQLite.index("connect_conv_channels_deleted_at_idx", ["deletedAt"]),
	],
})
export type ConnectConversationChannel = SQLite.SelectRowOf<typeof connectConversationChannelsTable>
export type NewConnectConversationChannel = SQLite.InsertRowOf<typeof connectConversationChannelsTable>

export const connectConversationsTable = SQLite.table("connect_conversations", {
	columns: {
		id: SQLite.column(uuid(ConnectConversationId), { defaultExpr: randomUuid }),
		hostOrganizationId: uuid(OrganizationId),
		hostChannelId: uuid(ChannelId),
		status: SQLite.column(connectConversationStatusEnum, { default: "active" }),
		settings: SQLite.nullable(jsonb<Record<string, unknown>>()),
		createdBy: uuid(UserId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("connect_conversations_host_org_idx", ["hostOrganizationId"]),
		SQLite.index("connect_conversations_host_channel_idx", ["hostChannelId"]),
		SQLite.index("connect_conversations_status_idx", ["status"]),
		SQLite.index("connect_conversations_deleted_at_idx", ["deletedAt"]),
	],
})
export type ConnectConversation = SQLite.SelectRowOf<typeof connectConversationsTable>
export type NewConnectConversation = SQLite.InsertRowOf<typeof connectConversationsTable>

export const connectInvitesTable = SQLite.table("connect_invites", {
	columns: {
		id: SQLite.column(uuid(ConnectInviteId), { defaultExpr: randomUuid }),
		conversationId: uuid(ConnectConversationId),
		hostOrganizationId: uuid(OrganizationId),
		hostChannelId: uuid(ChannelId),
		targetKind: connectInviteTargetKindEnum,
		targetValue: varchar(255),
		guestOrganizationId: SQLite.nullable(uuid(OrganizationId)),
		status: SQLite.column(connectInviteStatusEnum, { default: "pending" }),
		allowGuestMemberAdds: SQLite.column(SQLite.boolean, { default: false }),
		invitedBy: uuid(UserId),
		acceptedBy: SQLite.nullable(uuid(UserId)),
		acceptedAt: SQLite.nullable(timestamptz),
		expiresAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("connect_invites_conversation_idx", ["conversationId"]),
		SQLite.index("connect_invites_host_org_idx", ["hostOrganizationId"]),
		SQLite.index("connect_invites_guest_org_idx", ["guestOrganizationId"]),
		SQLite.index("connect_invites_status_idx", ["status"]),
		SQLite.index("connect_invites_target_idx", ["targetKind", "targetValue"]),
		SQLite.index("connect_invites_deleted_at_idx", ["deletedAt"]),
	],
})
export type ConnectInvite = SQLite.SelectRowOf<typeof connectInvitesTable>
export type NewConnectInvite = SQLite.InsertRowOf<typeof connectInvitesTable>

export const connectParticipantsTable = SQLite.table("connect_participants", {
	columns: {
		id: SQLite.column(uuid(ConnectParticipantId), { defaultExpr: randomUuid }),
		conversationId: uuid(ConnectConversationId),
		channelId: uuid(ChannelId),
		userId: uuid(UserId),
		homeOrganizationId: uuid(OrganizationId),
		isExternal: SQLite.column(SQLite.boolean, { default: false }),
		addedBy: SQLite.nullable(uuid(UserId)),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("connect_participants_conversation_idx", ["conversationId"]),
		SQLite.index("connect_participants_channel_idx", ["channelId"]),
		SQLite.index("connect_participants_user_idx", ["userId"]),
		SQLite.index("connect_participants_deleted_at_idx", ["deletedAt"]),
	],
})
export type ConnectParticipant = SQLite.SelectRowOf<typeof connectParticipantsTable>
export type NewConnectParticipant = SQLite.InsertRowOf<typeof connectParticipantsTable>
