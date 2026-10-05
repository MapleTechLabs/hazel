import { schema } from "@hazel/db"
import { Effect, Match, Schema } from "effect"
import type { AuthenticatedBot } from "../auth/bot-auth"
import type { WhereClauseResult } from "./where-clause-builder"

/**
 * Error thrown when bot table access is denied or where clause cannot be generated
 */
export class BotTableAccessError extends Schema.TaggedError<BotTableAccessError>()("BotTableAccessError", {
	message: Schema.String,
	detail: Schema.optional(Schema.String),
	table: Schema.String,
}) {}

/**
 * Tables that bots can access through the Electric proxy.
 * This is a restricted subset - more tables can be added as needed.
 */
export const BOT_ALLOWED_TABLES = ["messages", "channels", "channel_members"] as const

export type BotAllowedTable = (typeof BOT_ALLOWED_TABLES)[number]

/**
 * Check if a table name is allowed for bots
 */
export function isBotTableAllowed(table: string): table is BotAllowedTable {
	return BOT_ALLOWED_TABLES.includes(table as BotAllowedTable)
}

/**
 * Validate that a table parameter is present and allowed for bots
 */
export function validateBotTable(table: string | null): {
	valid: boolean
	table?: BotAllowedTable
	error?: string
} {
	if (!table) {
		return {
			valid: false,
			error: "Missing required parameter: table",
		}
	}

	if (!isBotTableAllowed(table)) {
		return {
			valid: false,
			error: `Table '${table}' is not allowed for bots. Allowed tables: ${BOT_ALLOWED_TABLES.join(", ")}`,
		}
	}

	return {
		valid: true,
		table: table as BotAllowedTable,
	}
}

/**
 * Get the WHERE clause for a table based on the authenticated bot.
 * This ensures bots can only access data from channels they're installed in.
 *
 * Uses unqualified column names (via column.name) for Electric SQL compatibility.
 * All WHERE clauses are parameterized for security.
 *
 * @param table - The table name
 * @param bot - The authenticated bot context
 * @returns Effect that succeeds with WhereClauseResult or fails with BotTableAccessError
 */
export function getBotWhereClauseForTable(
	table: BotAllowedTable,
	bot: AuthenticatedBot,
): Effect.Effect<WhereClauseResult, BotTableAccessError> {
	const botOrgSubquery = `(SELECT "organizationId" FROM bot_installations WHERE "botId" = $1)`
	const botVisibleChannelSubquery = `(SELECT "id" FROM channels WHERE "deletedAt" IS NULL AND "organizationId" IN ${botOrgSubquery})`

	return Match.value(table).pipe(
		Match.when("messages", () =>
			// Messages from all non-deleted channels in orgs where the bot is installed.
			Effect.succeed({
				whereClause: `"${schema.messagesTable.deletedAt.name}" IS NULL AND "${schema.messagesTable.channelId.name}" IN ${botVisibleChannelSubquery}`,
				params: [bot.botId],
			}),
		),

		Match.when("channels", () =>
			// Channels from orgs where the bot is installed.
			Effect.succeed({
				whereClause: `"${schema.channelsTable.deletedAt.name}" IS NULL AND "${schema.channelsTable.organizationId.name}" IN ${botOrgSubquery}`,
				params: [bot.botId],
			}),
		),

		Match.when("channel_members", () =>
			// Channel members in channels from orgs where the bot is installed.
			Effect.succeed({
				whereClause: `"${schema.channelMembersTable.deletedAt.name}" IS NULL AND "${schema.channelMembersTable.channelId.name}" IN ${botVisibleChannelSubquery}`,
				params: [bot.botId],
			}),
		),

		Match.orElse((table) =>
			Effect.fail(
				new BotTableAccessError({
					message: "Table not handled in bot where clause system",
					detail: `Missing where clause implementation for table: ${table}`,
					table,
				}),
			),
		),
	)
}
