import { ChannelId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Subscription } from "foldkit"
import { channelCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"
import { interaction } from "./update"

interface ChannelRow {
	readonly channel: { readonly id: ChannelId; readonly name: string; readonly icon?: string | null }
}

const own = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	channel: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				// Same query as `OverviewPage`.
				liveQueryStream<ChannelRow, Message>(
					(q) =>
						q
							.from({ channel: channelCollection })
							.where(({ channel }) => eq(channel.id, channelId))
							.findOne()
							.select(({ channel }) => ({ channel })),
					(rows) => {
						const row = rows[0]
						return Message.UpdatedChannel({
							channel: row
								? {
										id: row.channel.id,
										name: row.channel.name,
										icon: row.channel.icon ?? null,
									}
								: null,
						})
					},
				),
		},
	),
}))

export const subscriptions = { ...own, ...interaction.subscriptions }
