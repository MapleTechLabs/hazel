import { BotId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, timestamptz, uuid, varchar } from "./columns"
import type { IntegrationConnection } from "./integration-connections"

type IntegrationProvider = IntegrationConnection["provider"]

export const botsTable = SQLite.table("bots", {
	columns: {
		id: SQLite.column(uuid(BotId), { defaultExpr: randomUuid }),
		userId: uuid(UserId),
		createdBy: uuid(UserId),
		name: varchar(100),
		description: SQLite.nullable(SQLite.text),
		webhookUrl: SQLite.nullable(SQLite.text),
		apiTokenHash: SQLite.text,
		scopes: SQLite.nullable(jsonb<string[]>()),
		metadata: SQLite.nullable(jsonb<Record<string, any>>()),
		isPublic: SQLite.column(SQLite.boolean, { default: false }),
		installCount: SQLite.column(SQLite.integer, { default: 0 }),
		mentionable: SQLite.column(SQLite.boolean, { default: false }),
		allowedIntegrations: SQLite.column(SQLite.nullable(jsonb<IntegrationProvider[]>()), { default: [] }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("bots_userId_unique", ["userId"]),
		SQLite.index("bots_user_id_idx", ["userId"]),
		SQLite.index("bots_created_by_idx", ["createdBy"]),
		SQLite.index("bots_is_public_idx", ["isPublic"]),
		SQLite.index("bots_deleted_at_idx", ["deletedAt"]),
	],
})
export type Bot = SQLite.SelectRowOf<typeof botsTable>
export type NewBot = SQLite.InsertRowOf<typeof botsTable>
