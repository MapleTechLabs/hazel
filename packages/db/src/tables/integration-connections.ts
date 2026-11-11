import { IntegrationConnectionId, OrganizationId, UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, typed, uuid, varchar } from "./columns"

export const connectionLevelEnum = textEnum(["organization", "user"])
export const connectionStatusEnum = textEnum(["active", "expired", "revoked", "error", "suspended"])

export const integrationConnectionsTable = SQLite.table("integration_connections", {
	columns: {
		id: SQLite.column(uuid(IntegrationConnectionId), { defaultExpr: randomUuid }),
		provider: typed<
			"linear" | "github" | "figma" | "notion" | "discord" | "slack" | "craft" | "t3code"
		>()(varchar(50)),
		organizationId: uuid(OrganizationId),
		userId: SQLite.nullable(uuid(UserId)),
		level: connectionLevelEnum,
		status: SQLite.column(connectionStatusEnum, { default: "active" }),
		externalAccountId: SQLite.nullable(varchar(255)),
		externalAccountName: SQLite.nullable(varchar(255)),
		connectedBy: uuid(UserId),
		settings: SQLite.nullable(jsonb<Record<string, any>>()),
		metadata: SQLite.nullable(jsonb<Record<string, any>>()),
		errorMessage: SQLite.nullable(SQLite.text),
		lastUsedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("int_conn_org_idx", ["organizationId"]),
		SQLite.index("int_conn_provider_idx", ["provider"]),
		SQLite.index("int_conn_status_idx", ["status"]),
		SQLite.index("int_conn_deleted_at_idx", ["deletedAt"]),
		SQLite.uniqueIndex("int_conn_org_user_provider_unique", ["organizationId", "userId", "provider"]),
	],
})
export type IntegrationConnection = SQLite.SelectRowOf<typeof integrationConnectionsTable>
export type NewIntegrationConnection = SQLite.InsertRowOf<typeof integrationConnectionsTable>
