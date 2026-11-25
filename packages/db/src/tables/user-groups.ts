/**
 * User groups: Discord's mentionable roles. An organization's owners and admins name a group of
 * members (`@design`), and `@[group:<id>]` in a message mentions each of them. Streamed to the
 * organization's members (not Connect guests).
 */
import { OrganizationId, UserGroupId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const userGroupsTable = SQLite.table("user_groups", {
	columns: {
		id: SQLite.column(uuid(UserGroupId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		/** Lowercase slug, what `@` shows; unique per organization among groups not deleted. */
		handle: varchar(64),
		name: varchar(255),
		description: SQLite.nullable(SQLite.text),
		createdBy: uuid(UserId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("user_groups_organization_id_idx", ["organizationId"])],
})
export type UserGroup = SQLite.SelectRowOf<typeof userGroupsTable>
export type NewUserGroup = SQLite.InsertRowOf<typeof userGroupsTable>

export const userGroupMembersTable = SQLite.table("user_group_members", {
	columns: {
		groupId: uuid(UserGroupId),
		userId: uuid(UserId),
		addedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["groupId", "userId"],
	indexes: [SQLite.index("user_group_members_user_id_idx", ["userId"])],
})
export type UserGroupMember = SQLite.SelectRowOf<typeof userGroupMembersTable>
