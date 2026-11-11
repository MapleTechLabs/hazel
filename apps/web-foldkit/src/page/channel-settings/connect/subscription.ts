import { ChannelId, type ConnectConversationId, type OrganizationId } from "@hazel/schema"
import { eq, inArray } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	channelCollection,
	connectConversationChannelCollection,
	organizationCollection,
} from "~/db/collections"
import { getSharedConversationMountsForChannel } from "~/lib/connect-shared-channels"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message, type Model, type OrgSummary } from "./model"
import { interaction } from "./update"

interface MountRow {
	readonly id: string
	readonly channelId: ChannelId
	readonly conversationId: ConnectConversationId
	readonly organizationId: OrganizationId
	readonly role: "host" | "guest"
	readonly isActive: boolean
	readonly deletedAt: Date | null
}

interface OrgRow {
	readonly id: OrganizationId
	readonly name: string
	readonly slug?: string | null
	readonly logoUrl?: string | null
}

/** Joined with "," so the dependency is a stable string. */
const mountOrgIds = (model: Model) =>
	[...new Set(model.mounts.map((mount) => mount.organizationId))].sort().join(",")

const dataSubscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	channelName: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				liveQueryStream<{ readonly name: string }, Message>(
					(q) =>
						q
							.from({ channel: channelCollection })
							.where(({ channel }) => eq(channel.id, channelId))
							.findOne()
							.select(({ channel }) => ({ name: channel.name })),
					(rows) => Message.UpdatedChannelName({ name: rows[0]?.name ?? null }),
				),
		},
	),
	// Active mounts; shared when the conversation has more than one.
	mounts: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				liveQueryStream<MountRow, Message>(
					(q) =>
						q
							.from({ ccc: connectConversationChannelCollection })
							.where(({ ccc }) => eq(ccc.isActive, true))
							.select(({ ccc }) => ({ ...ccc })),
					(rows) =>
						Message.UpdatedMounts({
							mounts: getSharedConversationMountsForChannel(channelId, rows).map((mount) => ({
								id: mount.id,
								conversationId: mount.conversationId,
								organizationId: mount.organizationId,
								role: mount.role,
							})),
						}),
				),
		},
	),
	// `ConnectionRow`'s organization lookup, once for every row.
	orgs: entry(
		{ organizationIds: Schema.String },
		{
			modelToDependencies: ({ model }) => ({ organizationIds: mountOrgIds(model) }),
			dependenciesToStream: ({ organizationIds }) =>
				organizationIds === ""
					? Stream.empty
					: liveQueryStream<OrgRow, Message>(
							(q) =>
								q
									.from({ org: organizationCollection })
									.where(({ org }) => inArray(org.id, organizationIds.split(",")))
									.select(({ org }) => ({
										id: org.id,
										name: org.name,
										slug: org.slug,
										logoUrl: org.logoUrl,
									})),
							(rows) =>
								Message.UpdatedOrgs({
									orgs: Object.fromEntries(
										rows.map((row): [string, OrgSummary] => [
											row.id,
											{
												name: row.name,
												slug: row.slug ?? null,
												logoUrl: row.logoUrl ?? null,
											},
										]),
									),
								}),
						),
		},
	),
}))

export const subscriptions = { ...interaction.subscriptions, ...dataSubscriptions }
