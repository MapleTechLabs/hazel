import { OrganizationId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationMemberCollection, userCollection, userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model, TeamMember } from "./model"

interface TeamMemberRow {
	readonly id: string
	readonly userId: string
	readonly role: TeamMember["role"]
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
	readonly presence?: { readonly status: string; readonly lastSeenAt: Date } | undefined
}

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	teamMembers: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: liveQueryStream<TeamMemberRow, Message>(
							// Same query as `routes/_app/$orgSlug/settings/team.tsx`.
							(q) =>
								q
									.from({ members: organizationMemberCollection })
									.where(({ members }) => eq(members.organizationId, organizationId))
									.innerJoin({ user: userCollection }, ({ members, user }) =>
										eq(members.userId, user.id),
									)
									.leftJoin(
										{ presence: userPresenceStatusCollection },
										({ user, presence }) => eq(user.id, presence.userId),
									)
									.where(({ user }) => eq(user.userType, "user"))
									.select(({ members, user, presence }) => ({
										...members,
										user,
										presence,
									})),
							(rows) =>
								Message.UpdatedTeamMembers({
									members: rows.map((row) => ({
										id: row.id,
										userId: row.userId,
										role: row.role,
										firstName: row.user.firstName,
										lastName: row.user.lastName,
										email: row.user.email,
										avatarUrl: row.user.avatarUrl ?? null,
										presenceStatus: row.presence?.status ?? null,
										presenceLastSeenMs: row.presence
											? new Date(row.presence.lastSeenAt).getTime()
											: null,
									})),
								}),
						),
		},
	),
}))
