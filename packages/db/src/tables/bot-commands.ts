import { BotCommandId, BotId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, timestamptz, uuid, varchar } from "./columns"

/**
 * Argument definition for a bot command
 */
export interface BotCommandArgument {
	name: string
	description?: string
	required: boolean
	placeholder?: string
	type: "string" | "number" | "user" | "channel"
}

/**
 * Bot commands table - stores slash commands registered by bots
 */
export const botCommandsTable = SQLite.table("bot_commands", {
	columns: {
		id: SQLite.column(uuid(BotCommandId), { defaultExpr: randomUuid }),
		botId: uuid(BotId),
		name: varchar(50),
		description: SQLite.text,
		arguments: SQLite.column(SQLite.nullable(jsonb<BotCommandArgument[]>()), { default: [] }),
		usageExample: SQLite.nullable(SQLite.text),
		isEnabled: SQLite.column(SQLite.boolean, { default: true }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("bot_commands_bot_id_idx", ["botId"]),
		SQLite.uniqueIndex("bot_commands_bot_id_name_idx", ["botId", "name"]),
	],
})
export type BotCommand = SQLite.SelectRowOf<typeof botCommandsTable>
export type NewBotCommand = SQLite.InsertRowOf<typeof botCommandsTable>
