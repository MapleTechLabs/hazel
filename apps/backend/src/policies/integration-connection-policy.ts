import { ErrorUtils } from "@hazel/domain"
import type { OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

export class IntegrationConnectionPolicy extends Context.Service<IntegrationConnectionPolicy>()(
	"IntegrationConnectionPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "IntegrationConnection" as const

			const orgResolver = yield* OrgResolver

			const canSelect = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"select",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireScope(organizationId, scope, policyEntity, "select"),
					),
				)

			const canInsert = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"insert",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "insert"),
					),
				)

			const canUpdate = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"update",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "update"),
					),
				)

			const canDelete = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"delete",
				)(
					withAnnotatedScope((scope) =>
						orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, "delete"),
					),
				)

			return { canSelect, canInsert, canUpdate, canDelete } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(OrgResolver.layer))
}
