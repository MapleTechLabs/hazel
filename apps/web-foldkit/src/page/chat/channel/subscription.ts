import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { Subscription } from "foldkit"
import { channelStream, messagesStream, reactionsStream } from "../data"
import type { PageSubscriptionInput } from "../../contract"
import { Message, type Model } from "./page"

/** The channel page's live queries; split from `page.ts` so the update loop has no collection imports. */

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	channel: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				channelStream(channelId, (channel) => Message.UpdatedChannel({ channel })),
		},
	),
	messages: entry(
		{ channelId: ChannelId, limit: Schema.Number },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId, limit: model.limit }),
			dependenciesToStream: ({ channelId, limit }) =>
				messagesStream(channelId, limit, (messages) => Message.UpdatedMessages({ messages })),
		},
	),
	reactions: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				reactionsStream(channelId, (reactions) => Message.UpdatedReactions({ reactions })),
		},
	),
}))
