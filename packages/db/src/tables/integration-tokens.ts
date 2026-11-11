import { IntegrationConnectionId, IntegrationTokenId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { randomUuid, timestamptz, uuid, varchar } from "./columns"

export const integrationTokensTable = SQLite.table("integration_tokens", {
	columns: {
		id: SQLite.column(uuid(IntegrationTokenId), { defaultExpr: randomUuid }),
		connectionId: uuid(IntegrationConnectionId),
		encryptedAccessToken: SQLite.text,
		encryptedRefreshToken: SQLite.nullable(SQLite.text),
		iv: varchar(32),
		refreshTokenIv: SQLite.nullable(varchar(32)),
		encryptionKeyVersion: SQLite.column(SQLite.integer, { default: 1 }),
		tokenType: SQLite.column(SQLite.nullable(varchar(50)), { default: "Bearer" }),
		scope: SQLite.nullable(SQLite.text),
		expiresAt: SQLite.nullable(timestamptz),
		refreshTokenExpiresAt: SQLite.nullable(timestamptz),
		lastRefreshedAt: SQLite.nullable(timestamptz),
		createdAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		updatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("integration_tokens_connectionId_unique", ["connectionId"]),
		SQLite.index("int_tokens_connection_id_idx", ["connectionId"]),
		SQLite.index("int_tokens_expires_at_idx", ["expiresAt"]),
		SQLite.index("int_tokens_key_version_idx", ["encryptionKeyVersion"]),
	],
})
export type IntegrationToken = SQLite.SelectRowOf<typeof integrationTokensTable>
export type NewIntegrationToken = SQLite.InsertRowOf<typeof integrationTokensTable>
