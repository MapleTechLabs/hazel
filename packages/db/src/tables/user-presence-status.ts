import { ChannelId, UserId, UserPresenceStatusId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

/**
 * The status other people see, computed by the user's `UserObject` from their saved choice and their
 * live sessions. `away` is shown as Idle. `busy` is no longer written (old rows read as `dnd`).
 */
export const userPresenceStatusEnum = textEnum(["online", "away", "busy", "dnd", "offline"])

/** One kind of device's status (Discord's `client_status`); null when no session of that kind is live. */
export const clientPresenceStatusEnum = textEnum(["online", "away", "dnd"])

export const userPresenceStatusTable = SQLite.table("user_presence_status", {
	columns: {
		id: SQLite.column(uuid(UserPresenceStatusId), { defaultExpr: randomUuid }),
		userId: uuid(UserId),
		status: SQLite.column(userPresenceStatusEnum, { default: "online" }),
		customMessage: SQLite.nullable(varchar(255)),
		statusEmoji: SQLite.nullable(varchar(10)),
		statusExpiresAt: SQLite.nullable(timestamptz),
		activeChannelId: SQLite.nullable(uuid(ChannelId)),
		suppressNotifications: SQLite.column(SQLite.boolean, { default: false }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lastSeenAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		desktopStatus: SQLite.nullable(clientPresenceStatusEnum),
		webStatus: SQLite.nullable(clientPresenceStatusEnum),
		mobileStatus: SQLite.nullable(clientPresenceStatusEnum),
		/** No desktop or web session is in active use: mobile push goes out. */
		afk: SQLite.column(SQLite.boolean, { default: true }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("user_presence_status_userId_unique", ["userId"]),
		SQLite.index("user_presence_status_user_id_idx", ["userId"]),
		SQLite.index("user_presence_status_active_channel_idx", ["activeChannelId"]),
		SQLite.index("user_presence_status_last_seen_idx", ["lastSeenAt"]),
	],
})
export type UserPresenceStatus = SQLite.SelectRowOf<typeof userPresenceStatusTable>
export type NewUserPresenceStatus = SQLite.InsertRowOf<typeof userPresenceStatusTable>
