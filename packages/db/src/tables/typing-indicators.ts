import { ChannelId, ChannelMemberId, TypingIndicatorId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, uuid } from "./columns"

export const typingIndicatorsTable = SQLite.table("typing_indicators", {
	columns: {
		id: SQLite.column(uuid(TypingIndicatorId), { defaultExpr: randomUuid }),
		channelId: uuid(ChannelId),
		memberId: uuid(ChannelMemberId),
		lastTyped: SQLite.integer,
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("typing_indicators_channel_member_unique", ["channelId", "memberId"]),
		SQLite.index("typing_indicators_channel_timestamp_idx", ["channelId", "lastTyped"]),
		SQLite.index("typing_indicators_timestamp_idx", ["lastTyped"]),
	],
})
export type TypingIndicator = SQLite.SelectRowOf<typeof typingIndicatorsTable>
export type NewTypingIndicator = SQLite.InsertRowOf<typeof typingIndicatorsTable>
