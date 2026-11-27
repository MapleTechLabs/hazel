import type { IntegrationConnection } from "@hazel/domain/models"
import type { OrganizationId, UserId } from "@hazel/schema"
import { and, eq, type InitialQueryBuilder, isNull } from "@tanstack/db"
import { integrationConnectionCollection } from "~/db/collections"

export {
	Connection,
	type ConnectionRow,
	toConnection,
} from "@hazel/shared-screens/settings/integrations/data"

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

/** The member's own (user-level) connections in the organization; T3 Code links are per member. */
export const userConnectionsQuery =
	(organizationId: OrganizationId, userId: UserId, provider?: IntegrationConnection.IntegrationProvider) =>
	(q: InitialQueryBuilder) =>
		q
			.from({ connection: integrationConnectionCollection })
			.where(({ connection }) =>
				provider === undefined
					? and(
							eq(connection.organizationId, organizationId),
							eq(connection.level, "user"),
							eq(connection.userId, userId),
							isNull(connection.deletedAt),
						)
					: and(
							eq(connection.organizationId, organizationId),
							eq(connection.provider, provider),
							eq(connection.level, "user"),
							eq(connection.userId, userId),
							isNull(connection.deletedAt),
						),
			)
