import { UserId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { liveQueryStream } from "../../../../data/live-query"
import type { PageSubscriptionInput } from "../../../contract"
import { type BotRow, myBotsQuery, toBot } from "../shared/bots"
import { Message } from "./message"
import type { Model } from "./model"

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	myBots: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<BotRow, Message>(myBotsQuery(userId), (rows) =>
							Message.UpdatedBots({ bots: rows.map(toBot) }),
						),
		},
	),
}))
