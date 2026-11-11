import { CustomEmojiRepo } from "@hazel/backend-core"
import { ErrorUtils } from "@hazel/domain"
import type { CustomEmojiId, OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

export class CustomEmojiPolicy extends Context.Service<CustomEmojiPolicy>()("CustomEmojiPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "CustomEmoji" as const

		const orgResolver = yield* OrgResolver
		const customEmojiRepo = yield* CustomEmojiRepo

		const canCreate = (organizationId: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"create",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "create"),
				),
			)

		const canUpdate = (id: CustomEmojiId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"update",
			)(
				customEmojiRepo.with(id, (emoji) =>
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(emoji.organizationId, scope, policyEntity, "update"),
					),
				),
			)

		const canDelete = (id: CustomEmojiId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"delete",
			)(
				customEmojiRepo.with(id, (emoji) =>
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(emoji.organizationId, scope, policyEntity, "delete"),
					),
				),
			)

		return { canCreate, canUpdate, canDelete } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(CustomEmojiRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
