import { User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
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
