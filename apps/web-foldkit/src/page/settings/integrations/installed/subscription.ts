import { OrganizationId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import { type BotRow, installedBotsQuery, toBot } from "../shared/bots"
import { isIntegrationBot } from "../shared/integration-bots"
import { Message } from "./message"
import type { Model } from "./model"

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	installedBots: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.organization?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<BotRow, Message>(installedBotsQuery(organizationId), (rows) =>
							// An integration's bot is managed on its integration's page.
							Message.UpdatedBots({
								bots: rows.filter((row) => !isIntegrationBot(row.id)).map(toBot),
							}),
						),
		},
	),
}))
