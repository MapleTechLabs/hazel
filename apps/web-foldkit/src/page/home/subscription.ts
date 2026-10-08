import { OrganizationId, type UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationMemberCollection, userCollection, userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import * as Interaction from "../../ui/aria/interaction"
import type { PageSubscriptionInput } from "../contract"
import { Message } from "./message"
import { dmChannelsQuery } from "./dm"
import type { DirectoryMember, DmRow, Model } from "./model"

interface MemberRow {
	readonly id: UserId
	readonly firstName: string
	readonly lastName: string
	readonly email: string
	readonly avatarUrl?: string | null
	readonly role: DirectoryMember["role"]
	readonly presence?: { readonly status?: string | null } | undefined
}

const memberSubscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	members: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<MemberRow, Message>(
							// Same query as `routes/_app/$orgSlug/index.tsx`.
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.where(({ member }) => eq(member.organizationId, organizationId))
									.innerJoin({ user: userCollection }, ({ member, user }) =>
										eq(member.userId, user.id),
									)
									.leftJoin(
										{ presence: userPresenceStatusCollection },
										({ user, presence }) => eq(user.id, presence.userId),
									)
									.where(({ user }) => eq(user.userType, "user"))
									.select(({ member, user, presence }) => ({
										...user,
										role: member.role,
										joinedAt: member.joinedAt,
										presence,
									})),
							(rows) =>
								Message.UpdatedMembers({
									members: rows.map((row) => ({
										id: row.id,
										firstName: row.firstName,
										lastName: row.lastName,
										email: row.email,
										avatarUrl: row.avatarUrl ?? null,
										role: row.role,
										presenceStatus: row.presence?.status || null,
									})),
								}),
						),
		},
	),
	// Live while the page is open, so pressing Message finds an existing DM without a lookup.
	dmChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<DmRow, Message>(dmChannelsQuery, (rows) =>
							Message.UpdatedDmChannels({
								rows: rows.map(({ channel, member }) => ({
									channel: { id: channel.id, type: channel.type, organizationId: channel.organizationId },
									member: { userId: member.userId },
								})),
							}),
						),
		},
	),
}))

const interactionSubscriptions = Subscription.lift(Interaction.subscriptions)<
	PageSubscriptionInput<Model>,
	Message
>({
	read: (input) => Option.some(input.model.interaction),
	toParentMessage: (message) => Message.GotInteractionMessage({ message }),
})

export const subscriptions = { ...memberSubscriptions, ...interactionSubscriptions }
