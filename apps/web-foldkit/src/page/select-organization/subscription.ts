import { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { PageSubscriptionInput } from "../contract"
import { Message } from "./message"
import type { Model, UserOrganization } from "./model"

interface OrganizationRow {
	readonly member: { readonly role: UserOrganization["role"] }
	readonly org: {
		readonly id: UserOrganization["id"]
		readonly name: string
		readonly slug?: string | null
		readonly logoUrl?: string | null
	}
}

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	organizations: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<OrganizationRow, Message>(
							// Same query as `routes/_app/select-organization/index.tsx`.
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.innerJoin({ org: organizationCollection }, ({ member, org }) =>
										eq(member.organizationId, org.id),
									)
									.where(({ member }) => eq(member.userId, userId))
									.orderBy(({ member }) => member.joinedAt, "asc")
									.select(({ member, org }) => ({ member, org })),
							(rows) =>
								Message.UpdatedOrganizations({
									organizations: rows.map(({ member, org }) => ({
										id: org.id,
										name: org.name,
										slug: org.slug ?? null,
										logoUrl: org.logoUrl ?? null,
										role: member.role,
									})),
								}),
						),
		},
	),
}))
