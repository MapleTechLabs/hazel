/**
 * TODO(do-sync): runs in the caller's UserObject (`rpc/routing.ts`); not ported yet. To port: touch only
 * that store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - authoritative in the UserObject; project to each OrgObject (`membership_index`) through an org effect
 */
import { UserPresenceStatusRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { UserPresenceStatusResponse, UserPresenceStatusRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { UserPresenceStatusPolicy } from "../../policies/user-presence-status-policy"

export const UserPresenceStatusRpcLive = UserPresenceStatusRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const userPresenceStatusPolicy = yield* UserPresenceStatusPolicy
		const userPresenceStatusRepo = yield* UserPresenceStatusRepo

		return {
			"userPresenceStatus.update": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* userPresenceStatusPolicy.canRead()
							const existingOption = yield* userPresenceStatusRepo.findByUserId(user.id)

							const existing = Option.getOrNull(existingOption)

							const now = new Date()
							const updatedStatus = yield* userPresenceStatusRepo.upsertByUserId({
								userId: user.id,
								status: (payload.status ?? existing?.status ?? "online") as
									| "online"
									| "away"
									| "busy"
									| "dnd"
									| "offline",
								customMessage:
									payload.customMessage !== undefined
										? payload.customMessage
										: (existing?.customMessage ?? null),
								statusEmoji:
									payload.statusEmoji !== undefined
										? payload.statusEmoji
										: (existing?.statusEmoji ?? null),
								statusExpiresAt:
									payload.statusExpiresAt !== undefined
										? payload.statusExpiresAt
										: (existing?.statusExpiresAt ?? null),
								activeChannelId:
									payload.activeChannelId !== undefined
										? payload.activeChannelId
										: (existing?.activeChannelId ?? null),
								suppressNotifications:
									payload.suppressNotifications !== undefined
										? payload.suppressNotifications
										: (existing?.suppressNotifications ?? false),
								updatedAt: now,
								lastSeenAt: now, // Update heartbeat on any status change
							})

							const txid = yield* generateTransactionId()

							return new UserPresenceStatusResponse({
								data: updatedStatus!,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			"userPresenceStatus.heartbeat": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* userPresenceStatusPolicy.canUpdate()
							const result = yield* userPresenceStatusRepo.updateHeartbeat(user.id)

							// If no record exists, create one with online status
							if (Option.isNone(result)) {
								const now = new Date()
								yield* userPresenceStatusRepo.upsertByUserId({
									userId: user.id,
									status: "online",
									customMessage: null,
									statusEmoji: null,
									statusExpiresAt: null,
									activeChannelId: null,
									suppressNotifications: false,
									updatedAt: now,
									lastSeenAt: now,
								})

								return { lastSeenAt: now }
							}

							return { lastSeenAt: result.value.lastSeenAt }
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			"userPresenceStatus.clearStatus": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* userPresenceStatusPolicy.canRead()
							const existingOption = yield* userPresenceStatusRepo.findByUserId(user.id)

							const existing = Option.getOrNull(existingOption)

							const now = new Date()
							yield* userPresenceStatusPolicy.canCreate()
							const updatedStatus = yield* userPresenceStatusRepo.upsertByUserId({
								userId: user.id,
								status: existing?.status ?? "online",
								customMessage: null,
								statusEmoji: null,
								statusExpiresAt: null,
								activeChannelId: existing?.activeChannelId ?? null,
								suppressNotifications: false,
								updatedAt: now,
								lastSeenAt: now,
							})

							const txid = yield* generateTransactionId()

							return new UserPresenceStatusResponse({
								data: updatedStatus!,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),
		}
	}),
)
