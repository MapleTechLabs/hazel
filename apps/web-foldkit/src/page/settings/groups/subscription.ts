import { OrganizationId, type UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationMemberCollection, userCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import { userGroupsStream } from "../../../data/user-groups"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model } from "./model"

interface MemberRow {
	readonly userId: UserId
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
}

const byOrganization = { organizationId: Schema.NullOr(OrganizationId) }

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	groups: entry(byOrganization, {
		modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: userGroupsStream(organizationId, (groups) => Message.UpdatedGroups({ groups })),
	}),
	members: entry(byOrganization, {
		modelToDependencies: ({ shared }) => ({ organizationId: shared.organization?.id ?? null }),
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: liveQueryStream<MemberRow, Message>(
						(q) =>
							q
								.from({ members: organizationMemberCollection })
								.where(({ members }) => eq(members.organizationId, organizationId))
								.innerJoin({ user: userCollection }, ({ members, user }) =>
									eq(members.userId, user.id),
								)
								// People only: no bots or chat sync shadow users.
								.where(({ user }) => eq(user.userType, "user"))
								.select(({ members, user }) => ({ userId: members.userId, user })),
						(rows) =>
							Message.UpdatedMembers({
								members: rows
									.map((row) => ({
										userId: row.userId,
										name: `${row.user.firstName} ${row.user.lastName}`.trim(),
										email: row.user.email,
										avatarUrl: row.user.avatarUrl ?? null,
									}))
									.sort((a, b) => a.name.localeCompare(b.name)),
							}),
					),
	}),
}))
