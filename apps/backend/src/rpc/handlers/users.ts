/**
 * TODO(do-sync): runs in the directory (D1) (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - no transactions; profile updates project to each OrgObject's `users` (org effect per
 *   `membership_index` row)
 */
import { UserRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import { UserResponse, UserRpcs } from "@hazel/domain/rpc"
import { Config, Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { UserPolicy } from "../../policies/user-policy"

export const UserRpcLive = UserRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const userPolicy = yield* UserPolicy
		const userRepo = yield* UserRepo
		const publicUrl = yield* Config.option(Config.String("S3_PUBLIC_URL"))

		return {
			"user.me": () => CurrentUser.Context,

			"user.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* userPolicy.canUpdate(id)
							if (
								payload.avatarUrl != null &&
								!isAllowedAvatarUrl(payload.avatarUrl, Option.getOrUndefined(publicUrl), id)
							) {
								return yield* Effect.fail(
									new UnauthorizedError({
										message: "Invalid avatar URL",
										detail: "Use an avatar uploaded for this user",
									}),
								)
							}
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

/** Profile avatars must come from this user's upload prefix on the configured CDN. */
export const isAllowedAvatarUrl = (value: string, publicUrl: string | undefined, userId: string): boolean => {
	if (publicUrl === undefined) return false
	try {
		const base = new URL(publicUrl)
		const avatar = new URL(value)
		const prefix = `${base.pathname.replace(/\/$/, "")}/avatars/${userId}/`
		return (
			(avatar.protocol === "https:" || avatar.protocol === "http:") &&
			avatar.origin === base.origin &&
			avatar.username === "" &&
			avatar.password === "" &&
			avatar.pathname.startsWith(prefix) &&
			avatar.pathname.length > prefix.length
		)
	} catch {
		return false
	}
}
