import { ChannelRepo } from "@hazel/backend-core"
import { ErrorUtils } from "@hazel/domain"
import type { ChannelId, OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

export class ChannelPolicy extends Context.Service<ChannelPolicy>()("ChannelPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Channel" as const

		const orgResolver = yield* OrgResolver
		const channelRepo = yield* ChannelRepo

		const canCreate = (organizationId: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"create",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireScope(organizationId, scope, policyEntity, "create"),
				),
			)

		const canUpdate = (id: ChannelId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"update",
			)(
				channelRepo.with(id, (channel) =>
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(
							channel.organizationId,
							scope,
							policyEntity,
							"update",
						),
					),
				),
			)

		const canDelete = (id: ChannelId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"delete",
			)(
				channelRepo.with(id, (channel) =>
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(
							channel.organizationId,
							scope,
							policyEntity,
							"delete",
						),
					),
				),
			)

		return { canUpdate, canDelete, canCreate } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
