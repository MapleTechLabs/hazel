import { ChannelRepo, RssSubscriptionRepo } from "@hazel/backend-core"
import { ErrorUtils } from "@hazel/domain"
import type { ChannelId, OrganizationId, RssSubscriptionId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

/** @effect-leakable-service */
export class RssSubscriptionPolicy extends Context.Service<RssSubscriptionPolicy>()(
	"RssSubscriptionPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "RssSubscription" as const

			const channelRepo = yield* ChannelRepo
			const subscriptionRepo = yield* RssSubscriptionRepo
			const orgResolver = yield* OrgResolver

			const canCreate = (channelId: ChannelId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"create",
				)(
					channelRepo.with(channelId, (channel) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								channel.organizationId,
								scope,
								policyEntity,
								"create",
							),
						),
					),
				)

			const canRead = (channelId: ChannelId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"select",
				)(
					channelRepo.with(channelId, (channel) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								channel.organizationId,
								scope,
								policyEntity,
								"select",
							),
						),
					),
				)

			const canUpdate = (subscriptionId: RssSubscriptionId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"update",
				)(
					subscriptionRepo.with(subscriptionId, (subscription) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								subscription.organizationId,
								scope,
								policyEntity,
								"update",
							),
						),
					),
				)

			const canDelete = (subscriptionId: RssSubscriptionId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"delete",
				)(
					subscriptionRepo.with(subscriptionId, (subscription) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								subscription.organizationId,
								scope,
								policyEntity,
								"delete",
							),
						),
					),
				)

			const canReadByOrganization = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"select",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "select"),
					),
				)

			return { canCreate, canRead, canReadByOrganization, canUpdate, canDelete } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelRepo.layer),
		Layer.provide(RssSubscriptionRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
