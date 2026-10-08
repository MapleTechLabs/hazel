import type { User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { userCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { UserRow } from "./user"

interface UserCollectionRow {
	readonly firstName: string
	readonly lastName: string
	readonly email: string
	readonly avatarUrl?: string | null
	readonly timezone: string | null
	readonly settings: User.UserSettings | null
}

/** `useLiveQuery` on `userCollection` by id with `findOne()`, as `useNotificationSettings` does. */
export const userRowStream = <Message>(userId: UserId, toMessage: (row: UserRow | null) => Message) =>
	liveQueryStream<UserCollectionRow, Message>(
		(q) =>
			q
				.from({ u: userCollection })
				.where(({ u }) => eq(u.id, userId))
				.findOne(),
		(rows) => {
			const row = rows[0]
			return toMessage(
				row
					? {
							firstName: row.firstName,
							lastName: row.lastName,
							email: row.email,
							avatarUrl: row.avatarUrl ?? null,
							timezone: row.timezone,
							settings: row.settings,
						}
					: null,
			)
		},
	)
