import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { timestamptz, uuid } from "./columns"

export const channelAccessTable = SQLite.table("channel_access", {
	columns: {
		userId: uuid(UserId),
		channelId: uuid(ChannelId),
		organizationId: uuid(OrganizationId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["userId", "channelId"],
	indexes: [
		SQLite.index("channel_access_user_id_idx", ["userId"]),
		SQLite.index("channel_access_channel_id_idx", ["channelId"]),
		SQLite.index("channel_access_organization_id_idx", ["organizationId"]),
		SQLite.index("channel_access_org_user_idx", ["organizationId", "userId"]),
	],
})
export type ChannelAccess = SQLite.SelectRowOf<typeof channelAccessTable>
export type NewChannelAccess = SQLite.InsertRowOf<typeof channelAccessTable>
