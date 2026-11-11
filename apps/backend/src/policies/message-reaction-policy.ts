import { MessageReactionRepo, MessageRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { MessageId, MessageReactionId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { ChannelViewers } from "../services/channel-viewers"

/**
 * Reaction authorization, run inside the message's `ChannelObject`: reacting needs the message's
 * channel in the actor's `channel_viewers` (a Connect guest is a viewer too, so no separate
 * conversation check); changing or removing a reaction is its author's.
 */
export class MessageReactionPolicy extends Context.Service<MessageReactionPolicy>()(
	"MessageReactionPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "MessageReaction" as const

			const messageReactionRepo = yield* MessageReactionRepo
			const messageRepo = yield* MessageRepo
			const channelViewers = yield* ChannelViewers

			const ownReaction = (action: "update" | "delete") => (id: MessageReactionId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					action,
				)(
					messageReactionRepo.with(id, (reaction) =>
						policy(
							policyEntity,
							action,
							Effect.fn(`${policyEntity}.${action}`)(function* (actor) {
								return yield* Effect.succeed(actor.id === reaction.userId)
							}),
						),
					),
				)

			const canCreate = (messageId: MessageId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"create",
				)(
					messageRepo.with(messageId, (message) =>
						withAnnotatedScope((scope) =>
							Effect.asVoid(channelViewers.require(message.channelId, scope)),
						),
					),
				)

			/** Listing is gated by the route that reads (the channel's socket or its viewer check). */
			const canList = (_id: MessageId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"select",
				)(policy(policyEntity, "select", () => Effect.succeed(true)))

			const canUpdate = ownReaction("update")
			const canDelete = ownReaction("delete")

			return { canCreate, canDelete, canUpdate, canList } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(MessageReactionRepo.layer),
		Layer.provide(MessageRepo.layer),
		Layer.provide(ChannelViewers.layer),
	)
}
