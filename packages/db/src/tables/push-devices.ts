import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { textEnum, timestamptz, varchar } from "./columns"

export const pushEnvironmentEnum = textEnum(["development", "production"])

/**
 * A `UserObject` owner's phones that get a system notification for each of their notifications
 * (`apps/backend/src/worker/objects/user/push.ts`). Never synced to clients.
 */
export const pushDevicesTable = SQLite.table("push_devices", {
	columns: {
		/** The APNs device token, hex. */
		token: SQLite.text,
		/** Which APNs host the token belongs to. */
		environment: pushEnvironmentEnum,
		/** The app's bundle identifier: the APNs topic. */
		bundleId: varchar(255),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["token"],
})
export type PushDevice = SQLite.SelectRowOf<typeof pushDevicesTable>
export type NewPushDevice = SQLite.InsertRowOf<typeof pushDevicesTable>
