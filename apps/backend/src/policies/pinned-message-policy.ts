import { PinnedMessageRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { ChannelId, PinnedMessageId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { isAdminOrOwner, withAnnotatedScope } from "../lib/policy-utils"
import { ChannelViewers } from "../services/channel-viewers"

/**
 * Pin authorization, run inside the channel's `ChannelObject`: a viewer of the channel (its
 * `channel_viewers` row, with the scope) may pin; the pinner or an org admin or owner viewing
 * the channel may unpin. Differs from the org-table version: a member may pin in a private
 * channel they belong to (the object does not know the channel's type).
 */
export class PinnedMessagePolicy extends Context.Service<PinnedMessagePolicy>()(
	"PinnedMessagePolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "PinnedMessage" as const

			const pinnedMessageRepo = yield* PinnedMessageRepo
			const channelViewers = yield* ChannelViewers

			/** The pinner, or an admin or owner among the channel's viewers. */
			const pinnerOrAdmin = (action: "update" | "delete") => (id: PinnedMessageId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					action,
				)(
					pinnedMessageRepo.with(id, (pinnedMessage) =>
						withAnnotatedScope((scope) =>
							Effect.gen(function* () {
								const viewer = yield* channelViewers.require(pinnedMessage.channelId, scope)
								return yield* policy(
									policyEntity,
									action,
									Effect.fn(`${policyEntity}.${action}`)(function* (actor) {
										if (actor.id === pinnedMessage.pinnedBy) return true
										return viewer.role !== "guest" && isAdminOrOwner(viewer.role)
									}),
								)
							}),
						),
					),
				)

			const canCreate = (channelId: ChannelId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"create",
				)(withAnnotatedScope((scope) => Effect.asVoid(channelViewers.require(channelId, scope))))

			const canUpdate = pinnerOrAdmin("update")
			const canDelete = pinnerOrAdmin("delete")

			return { canCreate, canDelete, canUpdate } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PinnedMessageRepo.layer),
		Layer.provide(ChannelViewers.layer),
	)
}
