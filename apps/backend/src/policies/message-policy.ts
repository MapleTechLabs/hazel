import { MessageRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { ChannelId, MessageId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { isAdminOrOwner, withAnnotatedScope } from "../lib/policy-utils"
import { ChannelViewers } from "../services/channel-viewers"

/**
 * Message authorization, run inside the message's `ChannelObject`: access is the channel's
 * `channel_viewers` row for the actor (its org role, or a bot's scopes), not the org tables the
 * object does not hold. Ported from `OrgResolver.fromChannelWithAccess`; one difference: an org
 * admin reads a private channel only when it is in their `channel_access` (a member of it).
 */
export class MessagePolicy extends Context.Service<MessagePolicy>()("MessagePolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Message" as const

		const messageRepo = yield* MessageRepo
		const channelViewers = yield* ChannelViewers

		const canCreate = (channelId: ChannelId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"create",
			)(withAnnotatedScope((scope) => Effect.asVoid(channelViewers.require(channelId, scope))))

		const canRead = (channelId: ChannelId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"read",
			)(withAnnotatedScope((scope) => Effect.asVoid(channelViewers.require(channelId, scope))))

		const canUpdate = (id: MessageId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"update",
			)(
				messageRepo.with(id, (message) =>
					policy(
						policyEntity,
						"update",
						Effect.fn(`${policyEntity}.update`)(function* (actor) {
							// Only the author can update their own message
							return yield* Effect.succeed(actor.id === message.authorId)
						}),
					),
				),
			)

		const canDelete = (id: MessageId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"delete",
			)(
				messageRepo.with(id, (message) =>
					policy(
						policyEntity,
						"delete",
						Effect.fn(`${policyEntity}.delete`)(function* (actor) {
							// Author can delete their own message
							if (actor.id === message.authorId) return true
							// An admin or owner of the channel's organization can delete any message
							const viewer = yield* channelViewers.viewerOf(actor.id)
							return (
								Option.isSome(viewer) &&
								viewer.value.role !== "guest" &&
								isAdminOrOwner(viewer.value.role)
							)
						}),
					),
				),
			)

		return { canCreate, canRead, canUpdate, canDelete } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(MessageRepo.layer),
		Layer.provide(ChannelViewers.layer),
	)
}
