import { NotificationId, OrganizationMemberId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const notificationsTable = SQLite.table("notifications", {
	columns: {
		id: SQLite.column(uuid(NotificationId), { defaultExpr: randomUuid }),
		memberId: uuid(OrganizationMemberId),
		targetedResourceId: SQLite.nullable(SQLite.text),
		targetedResourceType: SQLite.nullable(varchar(50)),
		resourceId: SQLite.nullable(SQLite.text),
		resourceType: SQLite.nullable(varchar(50)),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		readAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("notifications_member_id_idx", ["memberId"]),
		SQLite.index("notifications_member_created_id_idx", ["memberId", "createdAt", "id"]),
		SQLite.index("notifications_targeted_resource_idx", ["targetedResourceId", "targetedResourceType"]),
		SQLite.index("notifications_resource_idx", ["resourceId", "resourceType"]),
		SQLite.index("notifications_read_at_idx", ["readAt"]),
	],
})
export type Notification = SQLite.SelectRowOf<typeof notificationsTable>
export type NewNotification = SQLite.InsertRowOf<typeof notificationsTable>
