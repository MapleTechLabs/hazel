import { OrganizationId, type UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationMemberCollection, userCollection, userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import * as Interaction from "../../ui/aria/interaction"
import type { PageSubscriptionInput } from "../contract"
import { Message } from "./message"
import type { DirectoryMember, Model } from "./model"

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
}))

const interactionSubscriptions = Subscription.lift(Interaction.subscriptions)<
	PageSubscriptionInput<Model>,
	Message
>({
	read: (input) => Option.some(input.model.interaction),
	toParentMessage: (message) => Message.GotInteractionMessage({ message }),
})

export const subscriptions = { ...memberSubscriptions, ...interactionSubscriptions }
