import { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import * as Interaction from "../../ui/aria/interaction"
import type { PageSubscriptionInput } from "../contract"
import { Message, toInteractionMessage } from "./message"
import type { Membership, Model } from "./model"

interface MembershipRow {
	readonly member: { readonly id: Membership["memberId"] }
	readonly org: {
		readonly id: Membership["organizationId"]
		readonly name: string
		readonly slug?: string | null
	}
}

const own = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	membership: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<MembershipRow, Message>(
							// Same query as `routes/_app/onboarding/index.tsx`: the oldest membership decides.
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.innerJoin({ org: organizationCollection }, ({ member, org }) =>
										eq(member.organizationId, org.id),
									)
									.where(({ member }) => eq(member.userId, userId))
									.orderBy(({ member }) => member.createdAt, "asc")
									.findOne(),
							(rows) => {
								const row = rows[0]
								return Message.UpdatedMembership({
									membership: row
										? {
												organizationId: row.org.id,
												memberId: row.member.id,
												name: row.org.name,
												slug: row.org.slug ?? null,
											}
										: null,
								})
							},
						),
		},
	),
}))

const interaction = Subscription.lift(Interaction.subscriptions)<PageSubscriptionInput<Model>, Message>({
	read: ({ model }) => Option.some(model.interaction),
	toParentMessage: toInteractionMessage,
})

export const subscriptions = Subscription.aggregate(own, interaction)
