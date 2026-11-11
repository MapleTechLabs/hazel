import type { IntegrationConnection } from "@hazel/domain/models"
import { OrganizationId, UserId } from "@hazel/schema"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { integrationConnectionCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import { type AccountConnection, LinkedProvider, type Model } from "./model"
import { interaction } from "./update"

interface ConnectionRow {
	readonly provider: string
	readonly status: IntegrationConnection.ConnectionStatus
	readonly externalAccountName?: string | null
}

const accountConnections = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	accountConnections: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.organization?.id ?? null,
				userId: shared.currentUser?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId, userId }) =>
				organizationId === null || userId === null
					? Stream.empty
					: liveQueryStream<ConnectionRow, Message>(
							// Same query as `useUserIntegrationConnection` in `db/hooks.ts`.
							(q) =>
								q
									.from({ connection: integrationConnectionCollection })
									.where(({ connection }) =>
										and(
											eq(connection.organizationId, organizationId),
											inArray(connection.provider, [...LinkedProvider.literals]),
											eq(connection.level, "user"),
											eq(connection.userId, userId),
											isNull(connection.deletedAt),
										),
									),
							(rows) => {
								const of = (provider: LinkedProvider): AccountConnection | null => {
									const row = rows.find((candidate) => candidate.provider === provider)
									return row
										? {
												status: row.status,
												externalAccountName: row.externalAccountName ?? null,
											}
										: null
								}
								return Message.UpdatedConnections({
									connections: { discord: of("discord"), slack: of("slack") },
								})
							},
						),
		},
	),
}))

export const subscriptions = Subscription.aggregate(accountConnections, interaction.subscriptions)
