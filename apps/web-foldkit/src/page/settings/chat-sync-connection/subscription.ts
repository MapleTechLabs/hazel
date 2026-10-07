import type { ChannelId } from "@hazel/schema"
import { inArray } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { channelCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message, type Model } from "./model"

interface ChannelNameRow {
	readonly id: ChannelId
	readonly name: string
}

/** Joined with "," so the dependency is a stable string. */
const linkedChannelIds = (model: Model) =>
	model.links._tag === "Loaded"
		? [...new Set(model.links.links.map((link) => link.hazelChannelId))].sort().join(",")
		: ""

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	// `ChannelLinkRow`'s lookup of the Hazel channel name, once for every row.
	channelNames: entry(
		{ channelIds: Schema.String },
		{
			modelToDependencies: ({ model }) => ({ channelIds: linkedChannelIds(model) }),
			dependenciesToStream: ({ channelIds }) =>
				channelIds === ""
					? Stream.empty
					: liveQueryStream<ChannelNameRow, Message>(
							(q) =>
								q
									.from({ channel: channelCollection })
									.where(({ channel }) => inArray(channel.id, channelIds.split(",")))
									.select(({ channel }) => ({ id: channel.id, name: channel.name })),
							(rows) =>
								Message.UpdatedChannelNames({
									names: Object.fromEntries(rows.map((row) => [row.id, row.name])),
								}),
						),
		},
	),
}))
