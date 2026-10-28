import { BotId, BotInstallationId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid } from "./columns"

export const botInstallationsTable = SQLite.table("bot_installations", {
	columns: {
		id: SQLite.column(uuid(BotInstallationId), { defaultExpr: randomUuid }),
		botId: uuid(BotId),
		organizationId: uuid(OrganizationId),
		installedBy: uuid(UserId),
		installedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("bot_installations_org_idx", ["organizationId"]),
		SQLite.index("bot_installations_bot_idx", ["botId"]),
		SQLite.uniqueIndex("bot_installations_bot_org_unique", ["botId", "organizationId"]),
	],
})
export type BotInstallation = SQLite.SelectRowOf<typeof botInstallationsTable>
export type NewBotInstallation = SQLite.InsertRowOf<typeof botInstallationsTable>
