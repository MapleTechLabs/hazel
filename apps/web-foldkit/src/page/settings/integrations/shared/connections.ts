import type { IntegrationConnection } from "@hazel/domain/models"
import type { OrganizationId } from "@hazel/schema"
import { and, eq, type InitialQueryBuilder, isNull } from "@tanstack/db"
import { Schema } from "effect"
import { integrationConnectionCollection } from "~/db/collections"

/** The connection fields the integration pages read (`useIntegrationConnection(s)` in `db/hooks.ts`). */
export const Connection = Schema.Struct({
	provider: Schema.String,
	isActive: Schema.Boolean,
	externalAccountName: Schema.NullOr(Schema.String),
	hasInstallationId: Schema.Boolean,
})
export type Connection = typeof Connection.Type

export interface ConnectionRow {
	readonly provider: IntegrationConnection.IntegrationProvider
	readonly status: IntegrationConnection.ConnectionStatus
	readonly externalAccountName?: string | null
	readonly metadata?: Readonly<Record<string, unknown>> | null
}

export const toConnection = (row: ConnectionRow): Connection => ({
	provider: row.provider,
	isActive: row.status === "active",
	externalAccountName: row.externalAccountName ?? null,
	hasInstallationId: Boolean(row.metadata?.installationId),
})

/** `useIntegrationConnections`, and with a provider `useIntegrationConnection`. */
export const connectionsQuery =
	(organizationId: OrganizationId, provider?: IntegrationConnection.IntegrationProvider) =>
	(q: InitialQueryBuilder) =>
		q
			.from({ connection: integrationConnectionCollection })
			.where(({ connection }) =>
				provider === undefined
					? and(
							eq(connection.organizationId, organizationId),
							eq(connection.level, "organization"),
							isNull(connection.userId),
							isNull(connection.deletedAt),
						)
					: and(
							eq(connection.organizationId, organizationId),
							eq(connection.provider, provider),
							eq(connection.level, "organization"),
							isNull(connection.userId),
							isNull(connection.deletedAt),
						),
			)
