import { UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { textEnum, timestamptz, uuid, varchar } from "./columns"

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

/**
 * Directory (D1): which user a device token belongs to now. A phone signed into another account
 * moves its token: the new owner's claim makes the previous owner's `UserObject` forget it
 * (`apps/backend/src/worker/objects/user/push-ownership.ts`).
 */
export const pushDeviceTokensTable = SQLite.table("push_device_tokens", {
	columns: {
		token: SQLite.text,
		userId: uuid(UserId),
		/** When the owner registered it; an older claim never overwrites a newer one. */
		updatedAt: timestamptz,
	},
	primaryKey: ["token"],
	indexes: [SQLite.index("push_device_tokens_user_id_idx", ["userId"])],
})
export type PushDeviceToken = SQLite.SelectRowOf<typeof pushDeviceTokensTable>
