import { OrganizationMemberRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { OrganizationMember } from "@hazel/domain/models"
import type { OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"

export class OrganizationMemberPolicy extends Context.Service<OrganizationMemberPolicy>()(
	"OrganizationMemberPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "OrganizationMember" as const

			const organizationMemberRepo = yield* OrganizationMemberRepo

			const canCreate = (organizationId: OrganizationId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"create",
				)(
					policy(
						policyEntity,
						"create",
						Effect.fn(`${policyEntity}.create`)(function* (actor) {
							// Check if user is already a member
							const currentMember = yield* organizationMemberRepo.findByOrgAndUser(
								organizationId,
								actor.id,
							)

							// If already a member, can't create another membership
							if (Option.isSome(currentMember)) {
								return yield* Effect.succeed(false)
							}

							// Allow users to join organizations
							return yield* Effect.succeed(true)
						}),
					),
				)

			/**
			 * A member may edit their own membership, admins and owners anyone's. A `role` change is
			 * only for admins and owners: owners may set any role; admins may neither grant `owner`
			 * nor change an owner's role. Pass the requested `role` (or none for other fields).
			 */
			const canUpdate = (
				id: OrganizationMemberId,
				change?: { readonly role?: OrganizationMember.OrganizationRole },
			) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"update",
				)(
					organizationMemberRepo.with(id, (member) =>
						policy(
							policyEntity,
							"update",
							Effect.fn(`${policyEntity}.update`)(function* (actor) {
								const currentMember = yield* organizationMemberRepo.findByOrgAndUser(
									member.organizationId,
									actor.id,
								)
								const actorRole = Option.map(currentMember, (row) => row.role)
								const isOwner = Option.contains(actorRole, "owner")
								const isAdmin = Option.contains(actorRole, "admin")

								const role = change?.role
								if (role !== undefined && role !== member.role) {
									if (isOwner) return true
									if (isAdmin) return role !== "owner" && member.role !== "owner"
									// Members (and outsiders) may not change roles, their own included.
									return false
								}

								if (actor.id === member.userId) return true
								return isOwner || isAdmin
							}),
						),
					),
				)

			const canDelete = (id: OrganizationMemberId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"delete",
				)(
					organizationMemberRepo.with(id, (member) =>
						policy(
							policyEntity,
							"delete",
							Effect.fn(`${policyEntity}.delete`)(function* (actor) {
								// Self-removal always allowed
								if (actor.id === member.userId) {
									return yield* Effect.succeed(true)
								}

								// Admins can remove members
								const currentMember = yield* organizationMemberRepo.findByOrgAndUser(
									member.organizationId,
									actor.id,
								)

								if (Option.isNone(currentMember)) {
									return yield* Effect.succeed(false)
								}

								return yield* Effect.succeed(currentMember.value.role === "admin")
							}),
						),
					),
				)

			return { canCreate, canUpdate, canDelete } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(OrganizationMemberRepo.layer))
}
