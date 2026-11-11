import { TypingIndicatorRepo } from "@hazel/backend-core"
import type { ChannelId, TypingIndicatorId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { makePolicy, withAnnotatedScope, withPolicyUnauthorized } from "../lib/policy-utils"
import { ChannelViewers } from "../services/channel-viewers"

/**
 * Typing authorization, run inside the channel's `ChannelObject`: any viewer of the channel.
 * An indicator's `memberId` is a `channel_members` row of the `OrgObject`, which this object
 * cannot resolve to a user, so the viewer is trusted with it (indicators expire in 10 s).
 */
export class TypingIndicatorPolicy extends Context.Service<TypingIndicatorPolicy>()(
	"TypingIndicatorPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "TypingIndicator" as const
			const authorize = makePolicy(policyEntity)

			const channelViewers = yield* ChannelViewers
			const typingIndicatorRepo = yield* TypingIndicatorRepo

			const viewerOf = (action: string, channelId: ChannelId) =>
				withPolicyUnauthorized(
					policyEntity,
					action,
					withAnnotatedScope((scope) => Effect.asVoid(channelViewers.require(channelId, scope))),
				)

			const canRead = (_id: TypingIndicatorId) => authorize("select", () => Effect.succeed(true))

			const canCreate = (channelId: ChannelId) => viewerOf("create", channelId)

			const canUpdate = (id: TypingIndicatorId) =>
				withPolicyUnauthorized(
					policyEntity,
					"update",
					typingIndicatorRepo.with(id, (indicator) => viewerOf("update", indicator.channelId)),
				)

			const canDelete = (id: TypingIndicatorId) =>
				withPolicyUnauthorized(
					policyEntity,
					"delete",
					typingIndicatorRepo.with(id, (indicator) => viewerOf("delete", indicator.channelId)),
				)

			return { canCreate, canUpdate, canDelete, canRead } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelViewers.layer),
		Layer.provide(TypingIndicatorRepo.layer),
	)
}
