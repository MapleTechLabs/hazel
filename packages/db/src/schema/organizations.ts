import type { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { sql } from "drizzle-orm"
import {
	boolean,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core"

// Organization member roles
export const organizationRoleEnum = pgEnum("organization_role", ["admin", "member", "owner"])

// Organizations table
export const organizationsTable = pgTable(
	"organizations",
	{
		id: uuid().primaryKey().defaultRandom().$type<OrganizationId>(),
		name: varchar({ length: 255 }).notNull(),
		slug: varchar({ length: 100 }).unique(),
		logoUrl: text(),
		settings: jsonb(),
		isPublic: boolean().notNull().default(false),
		createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp({ mode: "date", withTimezone: true }),
	},
	(table) => [
		index("organizations_slug_idx").on(table.slug),
		index("organizations_deleted_at_idx").on(table.deletedAt),
		// Defense-in-depth against the dedup-then-resync regression: even if a sync code path
		// forgets to look up by Clerk org ID first, the database itself rejects two live rows
		// claiming the same Clerk org. Partial so soft-deleted rows don't block re-creation.
		uniqueIndex("organizations_clerk_org_id_unique")
			.using("btree", sql`((${table.settings}->>'clerkOrganizationId'))`)
			.where(sql`${table.deletedAt} IS NULL AND ${table.settings}->>'clerkOrganizationId' IS NOT NULL`),
	],
)

// Organization members junction table
export const organizationMembersTable = pgTable(
	"organization_members",
	{
		id: uuid().primaryKey().defaultRandom().$type<OrganizationMemberId>(),
		organizationId: uuid()
			.notNull()
			.references(() => organizationsTable.id, { onDelete: "cascade" })
			.$type<OrganizationId>(),
		userId: uuid().notNull().$type<UserId>(),
		role: organizationRoleEnum().notNull().default("member"),
		nickname: varchar({ length: 100 }),
		joinedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
		invitedBy: uuid().$type<UserId>(),
		metadata: jsonb(),
		createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp({ mode: "date", withTimezone: true }),
	},
	(table) => [
		index("org_members_organization_id_idx").on(table.organizationId),
		index("org_members_user_id_idx").on(table.userId),
		unique("org_members_org_user_unique").on(table.organizationId, table.userId),
	],
)

// Type exports
export type Organization = typeof organizationsTable.$inferSelect
export type NewOrganization = typeof organizationsTable.$inferInsert
export type OrganizationMember = typeof organizationMembersTable.$inferSelect
export type NewOrganizationMember = typeof organizationMembersTable.$inferInsert
