import { User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { CommonReason, type UserErrorMessage } from "~/lib/error-messages"
import { catchCommon } from "../../data/actions"
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

/** Why `user.update` failed: the row is gone (`UserNotFoundError`), or a shared reason. */
export const UpdateUserFailure = Schema.Union([Schema.Literal("UserNotFound"), CommonReason])
export type UpdateUserFailure = typeof UpdateUserFailure.Type

/** The `failureMessage` copy for `UpdateUserFailure`'s own literal. */
export const updateUserFailureCopy: { readonly UserNotFound: UserErrorMessage } = {
	UserNotFound: { title: "Account not found", description: "Please sign in again." },
}

/** The `user.update` RPC behind the legacy `updateUserAction` (fields left out are not sent). */
export const updateUser = (payload: {
	readonly id: UserId
	readonly firstName?: string
	readonly lastName?: string
	readonly avatarUrl?: string | null
	readonly timezone?: string | null
	readonly settings?: User.UserSettings | null
}) => HazelRpc.use((rpc) => rpc("user.update", payload))

/** Settles a `user.update` into `onSuccess`, or its failure into an `UpdateUserFailure`. */
export const settleUpdateUser = <Success, Failure>(
	effect: ReturnType<typeof updateUser>,
	onSuccess: Success,
	onReason: (reason: UpdateUserFailure) => Failure,
) =>
	effect.pipe(
		Effect.as<Success | Failure>(onSuccess),
		Effect.catchTags({ UserNotFoundError: () => Effect.succeed(onReason("UserNotFound")) }),
		catchCommon(onReason),
	)
