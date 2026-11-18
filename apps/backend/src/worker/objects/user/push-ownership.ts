/**
 * Who a device token belongs to. Each user's `UserObject` keeps its own `push_devices`, so a
 * phone that signs into another account (without the first one's `pushDevice.unregister` ever
 * landing) would keep getting the first user's pushes. The directory's `push_device_tokens`
 * (D1) names the token's current owner, and a new owner's claim takes it from the previous one:
 *
 * 1. `pushDevice.register` (in the caller's `UserObject`) writes the local row with `updatedAt`
 *    = now and enqueues `directory.claimPushToken {token, userId, claimedAt}` in the same
 *    transaction.
 * 2. The claim runs in that object's outbox (directory effects run in the sender). It reads the
 *    token's row; if another user holds it with an older `updatedAt`, it enqueues
 *    `user.forgetPushDevice {token, claimedAt}` to that user's `UserObject`, then upserts the row
 *    (an older claim never overwrites a newer one). A claim older than the row it finds (a late
 *    retry) makes its own object forget the token instead. Each step is one statement and the
 *    forget's outbox id is fixed, so a retried claim repeats nothing.
 * 3. The previous owner's object deletes its row only if it is no newer than the claim, so a
 *    stale forget never removes a newer registration.
 *
 * `pushDevice.unregister` releases the directory row if it still names the caller.
 *
 * Until the forget lands, every send checks the directory too (`push.send`, `./push.ts`): a token
 * the directory gives another user at or after the local registration is not sent to, and its
 * local row goes. That also settles two users claiming an unowned token at the same moment (both
 * read no owner, so neither forgets the other): the earlier claimant's row can never send, and is
 * deleted on its next attempt.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { Directory } from "../../../services/directory"
import {
	CurrentEffectSender,
	defineEffect,
	EffectSenderRefusedError,
	enqueueEffect,
	type EffectReceivers,
} from "../effects/registry"

export const ClaimPushTokenPayload = Schema.Struct({
	token: Schema.String,
	userId: UserId,
	/** The local row's `updatedAt`, ISO. */
	claimedAt: Schema.String,
})

export const ReleasePushTokenPayload = Schema.Struct({ token: Schema.String, userId: UserId })

export const ForgetPushDevicePayload = Schema.Struct({
	token: Schema.String,
	/** Only a row registered at or before this (ISO) is forgotten. */
	claimedAt: Schema.String,
})

export const PushDirectoryEffects = {
	claimPushToken: defineEffect("directory.claimPushToken", "directory", ClaimPushTokenPayload),
	releasePushToken: defineEffect("directory.releasePushToken", "directory", ReleasePushTokenPayload),
}

export const PushOwnershipUserEffects = {
	forgetPushDevice: defineEffect("user.forgetPushDevice", "user", ForgetPushDevicePayload),
}

/** Only the `UserObject` of `userId` claims or releases its tokens. */
const requireUserSender = (kind: string, userId: UserId) =>
	Effect.flatMap(CurrentEffectSender, (sender) =>
		sender.kind === "user" && sender.id === userId
			? Effect.void
			: Effect.fail(
					new EffectSenderRefusedError({
						kind,
						message: `${kind} for user ${userId} sent by ${sender.kind}${"id" in sender ? `:${sender.id}` : ""}`,
					}),
				),
	)

/** A short FNV-1a hash of `token`: tells tokens apart in an outbox id without naming them. */
const tokenTag = (token: string) => {
	let hash = 0x811c9dc5
	for (let index = 0; index < token.length; index++) {
		hash = Math.imul(hash ^ token.charCodeAt(index), 0x01000193)
	}
	return (hash >>> 0).toString(16).padStart(8, "0")
}

/** `userId`'s `UserObject` forgets `token` if registered no later than `claimedAt`. */
const forget = (userId: UserId, token: string, claimedAt: Date, claimant: UserId) =>
	enqueueEffect(
		PushOwnershipUserEffects.forgetPushDevice,
		{ kind: "user", id: userId },
		{ token, claimedAt: claimedAt.toISOString() },
		// Fixed per claim (a retried claim enqueues nothing new), apart per token (two tokens
		// claimed in one millisecond). The token itself stays out of the id.
		{ id: `push-forget:${claimant}:${userId}:${claimedAt.getTime()}:${tokenTag(token)}` },
	)

/** The token's owner in the directory, and since when. */
export const tokenOwner = (token: string) =>
	Effect.flatMap(Directory, ({ db }) =>
		db.first(
			SQLite.from(schema.pushDeviceTokensTable)
				.select("userId", "updatedAt")
				.where(($) => [$.token.eq(token)])
				.limit(1),
		),
	)

const claimPushToken = Effect.fn("Directory.claimPushToken")(function* (
	payload: typeof ClaimPushTokenPayload.Type,
) {
	yield* requireUserSender("directory.claimPushToken", payload.userId)
	const { db } = yield* Directory
	const claimedAt = new Date(payload.claimedAt)
	const previous = yield* tokenOwner(payload.token)
	if (Option.isSome(previous) && previous.value.userId !== payload.userId) {
		if (previous.value.updatedAt.getTime() > claimedAt.getTime()) {
			// Someone registered the token after this claim: it is theirs.
			yield* forget(payload.userId, payload.token, previous.value.updatedAt, payload.userId)
			yield* Effect.annotateCurrentSpan({ "push.claim": "stale" })
			return
		}
		yield* forget(previous.value.userId, payload.token, claimedAt, payload.userId)
	}
	const written = yield* db.run(
		SQLite.insertInto(schema.pushDeviceTokensTable)
			.values({ token: payload.token, userId: payload.userId, updatedAt: claimedAt })
			.onConflictDoUpdate({
				target: ["token"],
				set: { userId: payload.userId, updatedAt: claimedAt },
				where: ($) => $.updatedAt.lte(claimedAt),
			})
			.returning("token"),
	)
	if (written.length === 0) {
		// A newer claim landed between the read and the write.
		const current = yield* tokenOwner(payload.token)
		if (Option.isSome(current) && current.value.userId !== payload.userId) {
			yield* forget(payload.userId, payload.token, current.value.updatedAt, payload.userId)
		}
	}
	yield* Effect.annotateCurrentSpan({
		"push.claim": Option.isSome(previous) && previous.value.userId !== payload.userId ? "moved" : "kept",
	})
})

const releasePushToken = Effect.fn("Directory.releasePushToken")(function* (
	payload: typeof ReleasePushTokenPayload.Type,
) {
	yield* requireUserSender("directory.releasePushToken", payload.userId)
	const { db } = yield* Directory
	yield* db.run(
		SQLite.deleteFrom(schema.pushDeviceTokensTable).where(($) => [
			$.token.eq(payload.token),
			$.userId.eq(payload.userId),
		]),
	)
})

export const pushDirectoryReceivers = {
	"directory.claimPushToken": claimPushToken,
	"directory.releasePushToken": releasePushToken,
} satisfies EffectReceivers<typeof PushDirectoryEffects, Directory | CurrentEffectSender | SqlClient>

const forgetPushDevice = Effect.fn("UserObject.forgetPushDevice")(function* (
	payload: typeof ForgetPushDevicePayload.Type,
) {
	const db = yield* Database.Database
	const forgotten = yield* db.run(
		SQLite.deleteFrom(schema.pushDevicesTable)
			.where(($) => [$.token.eq(payload.token), $.updatedAt.lte(new Date(payload.claimedAt))])
			.returning("token"),
	)
	yield* Effect.annotateCurrentSpan({ "push.forgotten": forgotten.length })
})

export const pushOwnershipUserReceivers = {
	"user.forgetPushDevice": forgetPushDevice,
} satisfies EffectReceivers<typeof PushOwnershipUserEffects, Database.Database>

/** Claim `token` for `userId` (inside the registration's transaction). */
export const claimToken = (userId: UserId, token: string, claimedAt: Date) =>
	enqueueEffect(
		PushDirectoryEffects.claimPushToken,
		{ kind: "directory" },
		{ token, userId, claimedAt: claimedAt.toISOString() },
	)

/** Release `token` if the directory still names `userId` (inside the unregistration's transaction). */
export const releaseToken = (userId: UserId, token: string) =>
	enqueueEffect(PushDirectoryEffects.releasePushToken, { kind: "directory" }, { token, userId })
