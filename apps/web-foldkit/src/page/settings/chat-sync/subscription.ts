import { type ChannelId, OrganizationId } from "@hazel/schema"
import { eq, or } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { channelCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message, type Model } from "./model"
import { interaction } from "./update"

interface ChannelNameRow {
	readonly id: ChannelId
	readonly name: string
}

const dataSubscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	// The email inbox channel picker, and each inbox's channel name: the org's public and private channels.
	hazelChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ model }) => ({ organizationId: model.requestedOrganizationId }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<ChannelNameRow, Message>(
							(q) =>
								q
									.from({ channel: channelCollection })
									.where(({ channel }) => eq(channel.organizationId, organizationId))
									.where(({ channel }) =>
										or(eq(channel.type, "public"), eq(channel.type, "private")),
									)
									.select(({ channel }) => ({ id: channel.id, name: channel.name })),
							(rows) =>
								Message.UpdatedHazelChannels({
									channels: rows.map((row) => ({ id: row.id, name: row.name })),
								}),
						),
		},
	),
}))

export const subscriptions = { ...interaction.subscriptions, ...dataSubscriptions }
