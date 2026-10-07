import { OrganizationId } from "@hazel/schema"
import type { BotId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import { installationsQuery, type PublicBotRow, publicBotsQuery, toPublicBot } from "../shared/bots"
import { Message } from "./message"
import { interaction } from "./update"
import type { Model } from "./model"

const toPublicBots = (rows: ReadonlyArray<PublicBotRow>) =>
	Message.UpdatedPublicBots({ bots: rows.map(toPublicBot) })

const dataSubscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	publicBots: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () => liveQueryStream<PublicBotRow, Message>(publicBotsQuery(), toPublicBots),
		},
	),
	installations: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.currentUser?.organizationId ?? null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<{ readonly botId: BotId }, Message>(
							installationsQuery(organizationId),
							(rows) => Message.UpdatedInstalledBotIds({ botIds: rows.map((row) => row.botId) }),
						),
		},
	),
}))

export const subscriptions = { ...interaction.subscriptions, ...dataSubscriptions }
