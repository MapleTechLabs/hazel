import { ChannelId, MessageId, PinnedMessageId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid } from "./columns"

export const pinnedMessagesTable = SQLite.table("pinned_messages", {
	columns: {
		id: SQLite.column(uuid(PinnedMessageId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		messageId: uuid(MessageId),
		pinnedBy: uuid(UserId),
		pinnedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("pinned_messages_channel_id_idx", ["channelId"]),
		SQLite.index("pinned_messages_message_id_idx", ["messageId"]),
		SQLite.uniqueIndex("pinned_messages_unique_idx", ["channelId", "messageId"]),
	],
})
export type PinnedMessage = SQLite.SelectRowOf<typeof pinnedMessagesTable>
export type NewPinnedMessage = SQLite.InsertRowOf<typeof pinnedMessagesTable>
