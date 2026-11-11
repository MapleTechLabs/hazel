import { CustomEmojiId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const customEmojisTable = SQLite.table("custom_emojis", {
	columns: {
		id: SQLite.column(uuid(CustomEmojiId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		name: varchar(64),
		imageUrl: SQLite.text,
		createdBy: uuid(UserId),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.nullable(timestamptz),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("custom_emojis_organization_id_idx", ["organizationId"]),
		SQLite.index("custom_emojis_name_idx", ["name"]),

		SQLite.index("custom_emojis_deleted_at_idx", ["deletedAt"]),
	],
})
export type CustomEmoji = SQLite.SelectRowOf<typeof customEmojisTable>
export type NewCustomEmoji = SQLite.InsertRowOf<typeof customEmojisTable>
