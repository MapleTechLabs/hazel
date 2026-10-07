import { eq } from "@tanstack/db"
import { channelMemberCollection, userCollection, userPresenceStatusCollection } from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import type { MentionMember, PresenceStatus } from "./composer"

/** Channel members for mention autocomplete: the exact query `useMentionOptions` runs. */
export const mentionMembersStream = <Message>(
	channelId: string,
	toMessage: (members: ReadonlyArray<MentionMember>) => Message,
) =>
	liveQueryStream<{ user?: { id: string; firstName: string; lastName: string; avatarUrl?: string | null } }, Message>(
		(q) =>
			q
				.from({ channelMember: channelMemberCollection })
				.innerJoin({ user: userCollection }, ({ channelMember, user }) => eq(channelMember.userId, user.id))
				.where(({ channelMember }) => eq(channelMember.channelId, channelId))
				.limit(100)
				.orderBy(({ channelMember }) => channelMember.joinedAt, "desc")
				.select(({ channelMember, user }) => ({ ...channelMember, user })),
		(rows) =>
			toMessage(
				rows.flatMap((row) =>
					row.user
						? [
								{
									userId: row.user.id,
									firstName: row.user.firstName,
									lastName: row.user.lastName,
									avatarUrl: row.user.avatarUrl ?? null,
								},
							]
						: [],
				),
			),
	)

/** Every presence row, as `useMentionOptions` reads it. */
export const presenceStream = <Message>(
	toMessage: (presence: ReadonlyArray<{ userId: string; status: PresenceStatus }>) => Message,
) =>
	liveQueryStream<{ userId: string; status: PresenceStatus }, Message>(
		(q) => q.from({ presence: userPresenceStatusCollection }).select(({ presence }) => presence),
		(rows) => toMessage(rows.map((row) => ({ userId: row.userId, status: row.status }))),
	)
