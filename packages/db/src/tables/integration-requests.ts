import { IntegrationRequestId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, textEnum, timestamptz, uuid, varchar } from "./columns"

export const integrationRequestStatusEnum = textEnum(["pending", "reviewed", "planned", "rejected"])

export const integrationRequestsTable = SQLite.table("integration_requests", {
	columns: {
		id: SQLite.column(uuid(IntegrationRequestId), { defaultExpr: randomUuid }),
		organizationId: uuid(OrganizationId),
		requestedBy: uuid(UserId),
		integrationName: varchar(255),
		integrationUrl: SQLite.nullable(varchar(500)),
		description: SQLite.nullable(SQLite.text),
		status: SQLite.column(integrationRequestStatusEnum, { default: "pending" }),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("integration_requests_organization_id_idx", ["organizationId"]),
		SQLite.index("integration_requests_status_idx", ["status"]),
		SQLite.index("integration_requests_created_at_idx", ["createdAt"]),
	],
})
export type IntegrationRequest = SQLite.SelectRowOf<typeof integrationRequestsTable>
export type NewIntegrationRequest = SQLite.InsertRowOf<typeof integrationRequestsTable>
