import {
	ChannelIcon,
	ChannelId,
	ChannelMemberId,
	ChannelSectionId,
	MessageId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const channelTypeEnum = textEnum(["public", "private", "thread", "direct", "single"])

export const channelMembersTable = SQLite.table("channel_members", {
	columns: {
		id: SQLite.column(uuid(ChannelMemberId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		userId: uuid(UserId),
		isHidden: SQLite.column(SQLite.boolean, { default: false }),
		isMuted: SQLite.column(SQLite.boolean, { default: false }),
		isFavorite: SQLite.column(SQLite.boolean, { default: false }),
		lastSeenMessageId: SQLite.nullable(uuid(MessageId)),
		notificationCount: SQLite.column(SQLite.integer, { default: 0 }),
		joinedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("channel_members_channel_id_idx", ["channelId"]),
		SQLite.index("channel_members_user_id_idx", ["userId"]),
		SQLite.index("channel_members_channel_user_idx", ["channelId", "userId"]),
	],
})
export type ChannelMember = SQLite.SelectRowOf<typeof channelMembersTable>
export type NewChannelMember = SQLite.InsertRowOf<typeof channelMembersTable>

export const channelsTable = SQLite.table("channels", {
	columns: {
		id: SQLite.column(uuid(ChannelId), { defaultExpr: randomUuid }),
		name: varchar(255),
		icon: SQLite.nullable(SQLite.brand(varchar(32), ChannelIcon)),
		type: channelTypeEnum,
		organizationId: uuid(OrganizationId),
		parentChannelId: SQLite.nullable(uuid(ChannelId)),
		sectionId: SQLite.nullable(uuid(ChannelSectionId)),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("channels_organization_id_idx", ["organizationId"]),
		SQLite.index("channels_parent_channel_id_idx", ["parentChannelId"]),
		SQLite.index("channels_section_id_idx", ["sectionId"]),
		SQLite.index("channels_type_idx", ["type"]),
		SQLite.index("channels_deleted_at_idx", ["deletedAt"]),
	],
})
export type Channel = SQLite.SelectRowOf<typeof channelsTable>
export type NewChannel = SQLite.InsertRowOf<typeof channelsTable>
