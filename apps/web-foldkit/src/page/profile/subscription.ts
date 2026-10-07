import { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Subscription } from "foldkit"
import { userCollection, userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { PageSubscriptionInput } from "../contract"
import { Message } from "./message"
import type { Model } from "./model"

interface ProfileRow {
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
	readonly presence?: { readonly status?: string | null; readonly lastSeenAt?: Date | null } | undefined
}

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	profileUser: entry(
		{ userId: UserId },
		{
			modelToDependencies: ({ model }) => ({ userId: model.userId }),
			dependenciesToStream: ({ userId }) =>
				liveQueryStream<ProfileRow, Message>(
					// `userWithPresenceAtomFamily(userId)` in `atoms/message-atoms.ts`.
					(q) =>
						q
							.from({ user: userCollection })
							.leftJoin({ presence: userPresenceStatusCollection }, ({ user, presence }) =>
								eq(user.id, presence.userId),
							)
							.where((row) => eq(row.user.id, userId))
							.select(({ user, presence }) => ({ user, presence })),
					(rows) => {
						const row = rows[0]
						const lastSeenAt = row?.presence?.lastSeenAt
						return Message.UpdatedProfileUser({
							user: row
								? {
										firstName: row.user.firstName,
										lastName: row.user.lastName,
										email: row.user.email,
										avatarUrl: row.user.avatarUrl ?? null,
										presenceStatus: row.presence?.status ?? null,
										presenceLastSeenMs: lastSeenAt
											? new Date(lastSeenAt).getTime()
											: null,
									}
								: null,
						})
					},
				),
		},
	),
}))
