import { OrganizationExportId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, textEnum, timestamptz, uuid } from "./columns"

export const organizationExportStatusEnum = textEnum(["pending", "running", "ready", "failed"])

/**
 * An organization data export (`apps/backend/src/worker/objects/org/exports.ts`), built by the
 * `OrgObject` on its alarm into the private exports bucket. `cursor` is where the build stands (the
 * next table or channel to read, and its page cursor); never synced to clients.
 */
export const organizationExportsTable = SQLite.table("organization_exports", {
	columns: {
		id: SQLite.column(uuid(OrganizationExportId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		requestedBy: uuid(UserId),
		status: SQLite.column(organizationExportStatusEnum, { default: "pending" }),
		cursor: SQLite.nullable(SQLite.text),
		/** Channels (threads included) whose rows are exported, and how many are done. */
		channelCount: SQLite.column(SQLite.integer, { default: 0 }),
		channelsDone: SQLite.column(SQLite.integer, { default: 0 }),
		partCount: SQLite.column(SQLite.integer, { default: 0 }),
		rowCount: SQLite.column(SQLite.integer, { default: 0 }),
		byteSize: SQLite.column(SQLite.integer, { default: 0 }),
		error: SQLite.nullable(SQLite.text),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		completedAt: SQLite.nullable(timestamptz),
		/** When the file is deleted from the bucket; downloads are refused after. */
		expiresAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("organization_exports_organization_id_idx", ["organizationId"]),
		SQLite.index("organization_exports_status_idx", ["status"]),
	],
})
export type OrganizationExport = SQLite.SelectRowOf<typeof organizationExportsTable>
export type NewOrganizationExport = SQLite.InsertRowOf<typeof organizationExportsTable>
