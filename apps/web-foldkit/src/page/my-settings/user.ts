import { User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Effect, Schema } from "effect"
import { userCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { HazelRpc } from "../../rpc"

/** The signed-in user's own `users` row, which the notification and profile pages edit. */
export const UserRow = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	timezone: Schema.NullOr(Schema.String),
	settings: Schema.NullOr(User.UserSettingsSchema),
})
export type UserRow = typeof UserRow.Type

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

/** The `user.update` RPC behind the legacy `updateUserAction` (fields left out are not sent). */
export const updateUser = (payload: {
	readonly id: UserId
	readonly timezone?: string | null
	readonly settings?: User.UserSettings | null
}) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		return yield* client("user.update", payload)
	})
