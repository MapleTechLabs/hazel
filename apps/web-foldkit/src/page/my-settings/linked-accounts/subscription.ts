import { OrganizationId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { integrationConnectionCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { DiscordConnection, Model } from "./model"
import { interaction } from "./update"

interface ConnectionRow {
	readonly status: string
	readonly externalAccountName?: string | null
}

const discordConnection = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	discordConnection: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.currentUser?.organizationId ?? null,
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
											eq(connection.provider, "discord"),
											eq(connection.level, "user"),
											eq(connection.userId, userId),
											isNull(connection.deletedAt),
										),
									),
							(rows) => {
								const row = rows[0]
								const connection: DiscordConnection | null = row
									? { status: row.status, externalAccountName: row.externalAccountName ?? null }
									: null
								return Message.UpdatedDiscordConnection({ connection })
							},
						),
		},
	),
}))

export const subscriptions = Subscription.aggregate(discordConnection, interaction.subscriptions)
