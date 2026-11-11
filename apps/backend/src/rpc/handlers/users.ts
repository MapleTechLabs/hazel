/**
 * Runs in the api Worker over the directory (D1): the `users` row is the directory's. D1 has no
 * transactions, so each write is one statement; the changed row is then projected to every org in
 * the user's `membership_index` (`org.upsertUserProjection`, applied right away, best effort) and
 * the response's transactionId is one of those orgs' write positions, so the client can await the
 * projection its collections read.
 */
import { UserRepo } from "@hazel/backend-core"
import { SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import { UserResponse, UserRpcs } from "@hazel/domain/rpc"
import type { UserId } from "@hazel/schema"
import { Config, Effect, Option } from "effect"
import { UserPolicy } from "../../policies/user-policy"
import { Directory } from "../../services/directory"
import { OrgEffects } from "../../worker/objects/effects/org-effects"
import { fanOut, transactionIdOf } from "../../worker/objects/fanout"
import { orgTarget } from "../../worker/objects/kinds"
import { toUserProjection } from "../../worker/objects/org/projections"

/** Copy `userId`'s directory row to each of their orgs; returns the transactionId to await. */
export const projectUserToOrgs = Effect.fn("User.projectToOrgs")(function* (userId: UserId) {
	const directory = yield* Directory
	const row = yield* directory.db.first(
		SQLite.from(schema.usersTable)
			.select()
			.where(($) => [$.id.eq(userId)])
			.limit(1),
	)
	if (Option.isNone(row)) return transactionIdOf([])
	const organizations = yield* directory.organizationsOf(userId)
	const applied = yield* fanOut(
		OrgEffects.upsertUserProjection,
		organizations.map(orgTarget),
		toUserProjection(row.value),
		crypto.randomUUID(),
	)
	return transactionIdOf(applied)
})

export const UserRpcLive = UserRpcs.toLayer(
	Effect.gen(function* () {
		const userPolicy = yield* UserPolicy
		const userRepo = yield* UserRepo
		const publicUrl = yield* Config.option(Config.String("S3_PUBLIC_URL"))

		return {
			"user.me": () => CurrentUser.Context,

			"user.update": ({ id, ...payload }) =>
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
					const updatedUser = yield* userRepo.update({ id, ...payload, updatedAt: new Date() })
					const transactionId = yield* projectUserToOrgs(id)
					return new UserResponse({ data: updatedUser, transactionId })
				}).pipe(withRemapDbErrors("User", "update")),

			"user.finalizeOnboarding": () =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context
					yield* userPolicy.canUpdate(currentUser.id)
					const updatedUser = yield* userRepo.update({
						id: currentUser.id,
						isOnboarded: true,
						updatedAt: new Date(),
					})
					const transactionId = yield* projectUserToOrgs(currentUser.id)
					return new UserResponse({ data: updatedUser, transactionId })
				}).pipe(withRemapDbErrors("User", "update")),
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
