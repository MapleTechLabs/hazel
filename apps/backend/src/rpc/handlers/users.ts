import { UserRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { UserResponse, UserRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { UserPolicy } from "../../policies/user-policy"

export const UserRpcLive = UserRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const userPolicy = yield* UserPolicy
		const userRepo = yield* UserRepo

		return {
			"user.me": () => CurrentUser.Context,

			"user.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* userPolicy.canUpdate(id)
							const updatedUser = yield* userRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new UserResponse({
								data: updatedUser,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("User", "update")),

			"user.finalizeOnboarding": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context

							yield* userPolicy.canUpdate(currentUser.id)
							const updatedUser = yield* userRepo.update({
								id: currentUser.id,
								isOnboarded: true,
							})

							const txid = yield* generateTransactionId()

							return new UserResponse({
								data: updatedUser,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("User", "update")),
		}
	}),
)
