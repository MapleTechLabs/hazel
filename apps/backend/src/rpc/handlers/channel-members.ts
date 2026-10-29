import { ChannelMemberRepo, ChannelRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { ChannelMemberResponse, ChannelMemberRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { ChannelMemberPolicy } from "../../policies/channel-member-policy"
import { BotGatewayEffects } from "../../worker/objects/effects/bot-gateway-effects"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { UserEffects } from "../../worker/objects/effects/user-effects"
import { userTarget } from "../../worker/objects/kinds"
import { syncMemberAccess } from "../../worker/objects/org/channel-access"

/**
 * Channel member RPC handlers. Run in the channel's `OrgObject` (`rpc/routing.ts`): membership
 * changes recompute the member's access and project it (`syncMemberAccess`); bots get
 * `channel_member.*` events from the outbox; clearing notifications resets the org-local unread
 * count and tells the user's `UserObject`, which holds the notifications.
 */
export const ChannelMemberRpcLive = ChannelMemberRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelMemberPolicy = yield* ChannelMemberPolicy
		const channelMemberRepo = yield* ChannelMemberRepo
		const channelRepo = yield* ChannelRepo

		const memberEvent = (
			eventType: "channel_member.add" | "channel_member.remove",
			member: Parameters<typeof channelMemberRepo.update>[0] & ChannelMemberResponse["data"],
		) =>
			Effect.gen(function* () {
				const channel = yield* channelRepo.findById(member.channelId)
				if (Option.isNone(channel)) return
				yield* enqueueEffect(
					BotGatewayEffects.channelMemberEvent,
					{ kind: "bot-gateway" },
					{ organizationId: channel.value.organizationId, eventType, member },
				)
				yield* syncMemberAccess(member.userId, channel.value.organizationId, { membership: false })
			})

		return {
			"channelMember.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* channelMemberPolicy.canCreate(payload.channelId)
							const createdChannelMember = yield* channelMemberRepo
								.insert({
									channelId: payload.channelId,
									userId: user.id,
									isHidden: false,
									isMuted: false,
									isFavorite: false,
									lastSeenMessageId: null,
									notificationCount: 0,
									joinedAt: new Date(),
									deletedAt: null,
								})
								.pipe(Effect.map((res) => res[0]!))

							yield* memberEvent("channel_member.add", createdChannelMember)

							const txid = yield* generateTransactionId()

							return new ChannelMemberResponse({
								data: createdChannelMember,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelMember", "create")),

			"channelMember.update": ({ id, organizationId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelMemberPolicy.canUpdate(id)
							const updatedChannelMember = yield* channelMemberRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new ChannelMemberResponse({
								data: updatedChannelMember,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelMember", "update")),

			"channelMember.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* channelMemberPolicy.canDelete(id)
							const deleted = yield* channelMemberRepo.findById(id)
							yield* channelMemberRepo.deleteById(id)
							if (Option.isSome(deleted)) {
								yield* memberEvent("channel_member.remove", deleted.value)
							}

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChannelMember", "delete")),

			"channelMember.clearNotifications": ({ channelId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* channelMemberPolicy.canRead(channelId)
							const member = yield* channelMemberRepo.findByChannelAndUser(channelId, user.id)
							if (Option.isSome(member)) {
								yield* channelMemberPolicy.canUpdate(member.value.id)
								yield* channelMemberRepo.update({
									id: member.value.id,
									notificationCount: 0,
								})
							}

							// The notifications themselves live in the user's UserObject.
							yield* enqueueEffect(UserEffects.clearChannelNotifications, userTarget(user.id), {
								channelId,
							})

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChannelMember", "update")),
		}
	}),
)
