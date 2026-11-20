import { ChannelId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { textEnum, timestamptz, uuid } from "./columns"

/** The kind of client a session runs in. */
export const presenceClientTypeEnum = textEnum(["desktop", "web", "mobile"])

/**
 * One row per sync socket open on the user's `UserObject` (not synced): Discord's gateway
 * sessions. The socket's pings keep `lastBeatAt` fresh; its `Presence` frames say whether it is
 * idle and which channel it shows. A socket that never sent one (an older client) is `legacy`.
 */
export const presenceSessionsTable = SQLite.table("presence_sessions", {
	columns: {
		id: SQLite.text,
		clientType: SQLite.nullable(presenceClientTypeEnum),
		idle: SQLite.column(SQLite.boolean, { default: false }),
		afk: SQLite.column(SQLite.boolean, { default: false }),
		focusedChannelId: SQLite.nullable(uuid(ChannelId)),
		legacy: SQLite.column(SQLite.boolean, { default: true }),
		connectedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lastBeatAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
})
export type PresenceSession = SQLite.SelectRowOf<typeof presenceSessionsTable>
