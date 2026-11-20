import { UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { textEnum, timestamptz, uuid } from "./columns"

/** The statuses a user can pick, as in Discord. */
export const preferredPresenceStatusEnum = textEnum(["online", "idle", "dnd", "invisible"])

/**
 * The status the user picked (`UserObject` only, synced to the user alone): it follows them to
 * every device. `statusExpiresAt` is when a timed pick (15 min ... 3 days) goes back to online.
 */
export const userPresenceSettingsTable = SQLite.table("user_presence_settings", {
	columns: {
		userId: uuid(UserId),
		status: SQLite.column(preferredPresenceStatusEnum, { default: "online" }),
		statusExpiresAt: SQLite.nullable(timestamptz),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["userId"],
})
export type UserPresenceSettings = SQLite.SelectRowOf<typeof userPresenceSettingsTable>
