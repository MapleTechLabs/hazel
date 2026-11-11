import { ChannelSectionRepo } from "@hazel/backend-core"
import { ErrorUtils } from "@hazel/domain"
import type { ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

export class ChannelSectionPolicy extends Context.Service<ChannelSectionPolicy>()(
	"ChannelSectionPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "ChannelSection" as const

			const orgResolver = yield* OrgResolver
			const channelSectionRepo = yield* ChannelSectionRepo

			const canCreate = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"create",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "create"),
					),
				)

			const canUpdate = (id: ChannelSectionId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"update",
				)(
					channelSectionRepo.with(id, (section) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								section.organizationId,
								scope,
								policyEntity,
								"update",
							),
						),
					),
				)

			const canDelete = (id: ChannelSectionId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"delete",
				)(
					channelSectionRepo.with(id, (section) =>
						withAnnotatedScope((scope) =>
							orgResolver.requireAdminOrOwner(
								section.organizationId,
								scope,
								policyEntity,
								"delete",
							),
						),
					),
				)

			const canReorder = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"reorder",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "reorder"),
					),
				)

			return { canCreate, canUpdate, canDelete, canReorder } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelSectionRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
