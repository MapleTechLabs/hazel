import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const organizationRoleEnum = textEnum(["admin", "member", "owner"])

export const organizationsTable = SQLite.table("organizations", {
	columns: {
		id: SQLite.column(uuid(OrganizationId), { defaultExpr: randomUuid }),
		name: varchar(255),
		slug: SQLite.nullable(varchar(100)),
		logoUrl: SQLite.nullable(SQLite.text),
		settings: SQLite.nullable(jsonb<unknown>()),
		isPublic: SQLite.column(SQLite.boolean, { default: false }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("organizations_slug_unique", ["slug"]),
		SQLite.index("organizations_slug_idx", ["slug"]),
		SQLite.index("organizations_deleted_at_idx", ["deletedAt"]),
	],
})
export type Organization = SQLite.SelectRowOf<typeof organizationsTable>
export type NewOrganization = SQLite.InsertRowOf<typeof organizationsTable>

export const organizationMembersTable = SQLite.table("organization_members", {
	columns: {
		id: SQLite.column(uuid(OrganizationMemberId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		userId: uuid(UserId),
		role: SQLite.column(organizationRoleEnum, { default: "member" }),
		nickname: SQLite.nullable(varchar(100)),
		joinedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		invitedBy: SQLite.nullable(uuid(UserId)),
		metadata: SQLite.nullable(jsonb<unknown>()),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("org_members_org_user_unique", ["organizationId", "userId"]),
		SQLite.index("org_members_organization_id_idx", ["organizationId"]),
		SQLite.index("org_members_user_id_idx", ["userId"]),
	],
})
export type OrganizationMember = SQLite.SelectRowOf<typeof organizationMembersTable>
export type NewOrganizationMember = SQLite.InsertRowOf<typeof organizationMembersTable>
