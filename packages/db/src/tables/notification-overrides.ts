/**
 * A member's notification settings above the channel (Discord's server and category settings):
 * for the whole organization or for one sidebar section. A channel's own setting
 * (`channel_members`) wins over its section's, which wins over the organization's, which wins over
 * the channel type's default. DMs take none of them. Streamed to their owner alone.
 */
import { OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { notificationLevelEnum } from "./channels"
import { textEnum, timestamptz, uuid } from "./columns"

export const notificationScopeEnum = textEnum(["organization", "section"])

export const notificationOverridesTable = SQLite.table("notification_overrides", {
	columns: {
		userId: uuid(UserId),
		organizationId: uuid(OrganizationId),
		scope: notificationScopeEnum,
		/** The organization's id, or the section's. */
		scopeId: SQLite.text,
		/** Null leaves the level to what is below (the channel type's default). */
		level: SQLite.nullable(notificationLevelEnum),
		isMuted: SQLite.column(SQLite.boolean, { default: false }),
		mutedUntil: SQLite.nullable(timestamptz),
		/** `@channel` and `@here` notify like any message (the organization's scope only). */
		suppressEveryone: SQLite.column(SQLite.boolean, { default: false }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["userId", "scope", "scopeId"],
	// Each message reads its channel's section and organization rows (`notification-service.ts`).
	indexes: [SQLite.index("notification_overrides_scope_idx", ["scope", "scopeId"])],
})
export type NotificationOverride = SQLite.SelectRowOf<typeof notificationOverridesTable>
