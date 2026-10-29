import { UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const userTypeEnum = textEnum(["user", "machine"])

export const usersTable = SQLite.table("users", {
	columns: {
		id: SQLite.column(uuid(UserId), { defaultExpr: randomUuid }),
		externalId: varchar(255),
		authActive: SQLite.column(SQLite.boolean, { default: true }),
		securityRevision: SQLite.column(SQLite.text, { default: "initial" }),
		email: varchar(255),
		firstName: varchar(100),
		lastName: varchar(100),
		avatarUrl: SQLite.nullable(SQLite.text),
		userType: SQLite.column(userTypeEnum, { default: "user" }),
		settings: SQLite.nullable(jsonb<Record<string, any>>()),
		isOnboarded: SQLite.column(SQLite.boolean, { default: false }),
		timezone: SQLite.nullable(varchar(100)),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("users_externalId_unique", ["externalId"]),
		SQLite.index("users_external_id_idx", ["externalId"]),
		SQLite.index("users_email_idx", ["email"]),
		SQLite.index("users_user_type_idx", ["userType"]),
		SQLite.index("users_deleted_at_idx", ["deletedAt"]),
	],
})
export type User = SQLite.SelectRowOf<typeof usersTable>
export type NewUser = SQLite.InsertRowOf<typeof usersTable>
