import { ErrorUtils } from "@hazel/domain"
import type { OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer } from "effect"
import { withAnnotatedScope } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

/** Only an organization's admins and owners invite, list and revoke its invitations. */
export class InvitationPolicy extends Context.Service<InvitationPolicy>()("InvitationPolicy/Policy", {
	make: Effect.gen(function* () {
		const policyEntity = "Invitation" as const
		const orgResolver = yield* OrgResolver

		const canManage = (organizationId: OrganizationId, action: "create" | "select" | "delete") =>
			ErrorUtils.refailUnauthorized(
				policyEntity,
				action,
			)(
				withAnnotatedScope((scope) =>
					orgResolver.requireAdminOrOwner(organizationId, scope, policyEntity, action),
				),
			)

		return { canManage } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(OrgResolver.layer))
}
