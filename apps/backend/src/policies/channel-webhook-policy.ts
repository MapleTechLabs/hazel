import { ChannelRepo, ChannelWebhookRepo } from "@hazel/backend-core"
import { ErrorUtils } from "@hazel/domain"
import type { ChannelId, ChannelWebhookId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

/** @effect-leakable-service */
export class ChannelWebhookPolicy extends Context.Service<ChannelWebhookPolicy>()(
	"ChannelWebhookPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "ChannelWebhook" as const

			const channelRepo = yield* ChannelRepo
			const webhookRepo = yield* ChannelWebhookRepo
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

			const canUpdate = (webhookId: ChannelWebhookId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"update",
				)(
					webhookRepo.with(webhookId, (webhook) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								webhook.organizationId,
								scope,
								policyEntity,
								"update",
							),
						),
					),
				)

			const canDelete = (webhookId: ChannelWebhookId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"delete",
				)(
					webhookRepo.with(webhookId, (webhook) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								webhook.organizationId,
								scope,
								policyEntity,
								"delete",
							),
						),
					),
				)

			return { canCreate, canRead, canUpdate, canDelete } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelRepo.layer),
		Layer.provide(ChannelWebhookRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
