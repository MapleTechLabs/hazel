import type { UserId } from "@hazel/schema"
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core"

export const userTypeEnum = pgEnum("user_type", ["user", "machine"])

export const usersTable = pgTable(
	"users",
	{
		id: uuid().primaryKey().defaultRandom().$type<UserId>(),
		externalId: varchar({ length: 255 }).notNull().unique(),
		email: varchar({ length: 255 }).notNull(),
		firstName: varchar({ length: 100 }).notNull(),
		lastName: varchar({ length: 100 }).notNull(),
		avatarUrl: text(),
		userType: userTypeEnum().notNull().default("user"),
		settings: jsonb().$type<Record<string, any>>(),
		isOnboarded: boolean().notNull().default(false),
		timezone: varchar({ length: 100 }), // IANA timezone identifier (e.g., "America/New_York")
		createdAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ mode: "date", withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp({ mode: "date", withTimezone: true }),
		// Hazel auth subject state (see auth.ts). `authActive` false blocks sign-in and ends
		// sessions; `securityRevision` changes when the user's sign-in methods change.
		authActive: boolean().notNull().default(true),
		securityRevision: text().notNull().default("initial"),
	},
	(table) => [
		index("users_external_id_idx").on(table.externalId),
		index("users_email_idx").on(table.email),
		index("users_user_type_idx").on(table.userType),
		index("users_deleted_at_idx").on(table.deletedAt),
	],
)

// Type exports
export type User = typeof usersTable.$inferSelect
export type NewUser = typeof usersTable.$inferInsert
