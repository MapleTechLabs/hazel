import { ChannelId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option } from "effect"
import { Subscription } from "foldkit"
import { channelCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import * as Interaction from "../../../ui/aria/interaction"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

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

const toInteractionMessage = (message: Interaction.Message) => Message.GotInteractionMessage({ message })

const interaction = Subscription.lift(Interaction.subscriptions)<PageSubscriptionInput<Model>, Message>({
	read: ({ model }) => Option.some(model.interaction),
	toParentMessage: toInteractionMessage,
})

export const subscriptions = { ...own, ...interaction }
