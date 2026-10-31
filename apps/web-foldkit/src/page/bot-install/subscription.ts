import { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { PageSubscriptionInput } from "../contract"
import { Message } from "./message"
import type { InstallTarget, Model } from "./model"

interface TargetRow {
	readonly member: { readonly role: "owner" | "admin" | "member" }
	readonly org: {
		readonly id: InstallTarget["id"]
		readonly name: string
		readonly logoUrl?: string | null
	}
}

/** The organizations the user administers: only an owner or admin can install (`BotPolicy.canInstall`). */
export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	targets: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<TargetRow, Message>(
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
								Message.UpdatedTargets({
									targets: rows
										.filter(
											({ member }) =>
												member.role === "owner" || member.role === "admin",
										)
										.map(({ org }) => ({
											id: org.id,
											name: org.name,
											logoUrl: org.logoUrl ?? null,
										})),
								}),
						),
		},
	),
}))
