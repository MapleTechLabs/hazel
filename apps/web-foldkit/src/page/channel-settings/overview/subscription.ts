import { ChannelId, OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { channelCollection } from "~/db/collections"
import { channelCustomerStream } from "../../../customers/channels"
import { accountsStream } from "../../../customers/queries"
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
	customer: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				channelCustomerStream(channelId, (customer) => Message.UpdatedCustomer({ customer })),
		},
	),
	// The Customers source opens only while the picker is open.
	customers: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ model, shared }) => ({
				organizationId: model.customerPopover.isOpen ? (shared.organization?.id ?? null) : null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: accountsStream(organizationId, (accounts) =>
							Message.UpdatedCustomers({
								customers: accounts.map((account) => ({
									id: account.id,
									name: account.name,
								})),
							}),
						),
		},
	),
}))

export const subscriptions = { ...own, ...interaction.subscriptions }
