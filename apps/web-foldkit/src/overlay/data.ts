import { createCollection, eq, liveQueryCollectionOptions } from "@tanstack/db"
import { channelMemberCollection, userCollection } from "~/db/collections"

/** Collections the overlays share. */

/** `db/materialized-collections.ts` `channelMemberWithUserCollection`, on `@tanstack/db` core. */
export const channelMemberWithUserCollection = createCollection(
	liveQueryCollectionOptions({
		query: (q) =>
			q
				.from({ member: channelMemberCollection })
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.select(({ member, user }) => ({ ...member, user })),
	}),
)
