import { OrganizationId, UserId } from "@hazel/schema"
import { eq, inArray } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	channelCollection,
	channelMemberCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { PageSubscriptionInput } from "../contract"
import { type ChannelRow, groupChannels } from "./group"
import { Message } from "./message"
import { type Model, type Presence, singleDmPartnerIds } from "./model"

interface PresenceRow {
	readonly userId: UserId
	readonly status?: string | null
	readonly lastSeenAt?: Date | null
}

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	channels: entry(
		{ organizationId: Schema.NullOr(OrganizationId), currentUserId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.organization?.id ?? null,
				currentUserId: shared.currentUser?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId, currentUserId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<ChannelRow, Message>(
							// Same query as `routes/_app/$orgSlug/chat/index.tsx`.
							(q) =>
								q
									.from({ channel: channelCollection })
									.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
										eq(member.channelId, channel.id),
									)
									.innerJoin({ user: userCollection }, ({ member, user }) =>
										eq(user.id, member.userId),
									)
									.where((row) => eq(row.channel.organizationId, organizationId))
									.orderBy(({ channel }) => channel.createdAt, "asc"),
							(rows) => Message.UpdatedChannels({ groups: groupChannels(rows, currentUserId) }),
						),
		},
	),
	// `useUserPresence(userId)` per single-DM card: the newest presence row of each partner.
	presence: entry(
		{ userIds: Schema.Array(UserId) },
		{
			modelToDependencies: ({ model, shared }) => ({
				userIds: singleDmPartnerIds(model.groups, shared.currentUser?.id),
			}),
			dependenciesToStream: ({ userIds }) =>
				userIds.length === 0
					? Stream.empty
					: liveQueryStream<PresenceRow, Message>(
							(q) =>
								q
									.from({ presence: userPresenceStatusCollection })
									.where(({ presence }) => inArray(presence.userId, [...userIds]))
									.orderBy(({ presence }) => presence.updatedAt, "desc"),
							(rows) => {
								const presence: Record<string, Presence> = {}
								for (const row of rows) {
									if (presence[row.userId]) continue
									presence[row.userId] = {
										status: row.status ?? null,
										lastSeenMs: row.lastSeenAt
											? new Date(row.lastSeenAt).getTime()
											: null,
									}
								}
								return Message.UpdatedPresence({ presence })
							},
						),
		},
	),
}))
