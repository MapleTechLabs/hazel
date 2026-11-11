import { ErrorUtils } from "@hazel/domain"
import type { OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { makePolicy, withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

export class OrganizationPolicy extends Context.Service<OrganizationPolicy>()("OrganizationPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Organization" as const
		const authorize = makePolicy(policyEntity)

		const orgResolver = yield* OrgResolver

		const canCreate = () => authorize("create", (_actor) => Effect.succeed(true))

		const canUpdate = (id: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"update",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(id, scope, policyEntity, "update"),
				),
			)

		const isMember = (id: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"isMember",
			)(withAnnotatedScope((scope) => orgResolver.requireScope(id, scope, policyEntity, "isMember")))

		const canDelete = (id: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"delete",
			)(withAnnotatedScope((scope) => orgResolver.requireOwner(id, scope, policyEntity, "delete")))

		const canManagePublicInvite = (id: OrganizationId) =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				"managePublicInvite",
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(id, scope, policyEntity, "managePublicInvite"),
				),
			)

		return { canUpdate, canDelete, canCreate, isMember, canManagePublicInvite } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(OrgResolver.layer))
}
