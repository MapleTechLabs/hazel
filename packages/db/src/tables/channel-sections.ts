import { ChannelSectionId, OrganizationId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const channelSectionsTable = SQLite.table("channel_sections", {
	columns: {
		id: SQLite.column(uuid(ChannelSectionId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		name: varchar(255),
		order: SQLite.column(SQLite.integer, { default: 0 }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("channel_sections_organization_id_idx", ["organizationId"]),
		SQLite.index("channel_sections_order_idx", ["organizationId", "order"]),
		SQLite.index("channel_sections_deleted_at_idx", ["deletedAt"]),
	],
})
export type ChannelSection = SQLite.SelectRowOf<typeof channelSectionsTable>
export type NewChannelSection = SQLite.InsertRowOf<typeof channelSectionsTable>
