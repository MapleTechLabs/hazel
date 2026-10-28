/**
 * A `ChannelObject`'s projections of its organization, written only by the `OrgObject`'s outbox.
 */
import { BotId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { textEnum, uuid } from "./columns"

/** Who may read the channel: its computed `channel_access`, with the viewer's org role. */
export const channelViewersTable = SQLite.table("channel_viewers", {
	columns: {
		userId: uuid(UserId),
		organizationId: uuid(OrganizationId),
		role: textEnum(["owner", "admin", "member", "guest"]),
	},
	primaryKey: ["userId"],
})
export type ChannelViewer = SQLite.SelectRowOf<typeof channelViewersTable>

/** The bots that receive the channel's events. */
export const channelBotsTable = SQLite.table("channel_bots", {
	columns: {
		botId: uuid(BotId),
		botUserId: uuid(UserId),
	},
	primaryKey: ["botId"],
})
export type ChannelBot = SQLite.SelectRowOf<typeof channelBotsTable>
