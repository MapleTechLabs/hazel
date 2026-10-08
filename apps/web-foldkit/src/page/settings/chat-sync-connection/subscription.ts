import { type ChannelId, OrganizationId } from "@hazel/schema"
import { eq, inArray, or } from "@tanstack/db"
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

/** Joined with "," so the dependency is a stable string. */
const linkedChannelIds = (model: Model) =>
	model.links._tag === "Loaded"
		? [...new Set(model.links.links.map((link) => link.hazelChannelId))].sort().join(",")
		: ""

const dataSubscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
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
	// `AddChannelLinkModal`'s public and private channels, once the connection is found.
	hazelChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ model }) => ({
				organizationId:
					model.connection._tag === "Loaded" && model.connection.connection !== null
						? model.requestedOrganizationId
						: null,
			}),
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
									.select(({ channel }) => ({ ...channel })),
							(rows) =>
								Message.UpdatedHazelChannels({
									channels: rows.map((row) => ({ id: row.id, name: row.name })),
								}),
						),
		},
	),
}))

export const subscriptions = { ...interaction.subscriptions, ...dataSubscriptions }
