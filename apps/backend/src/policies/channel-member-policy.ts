import { ChannelMemberRepo, ChannelRepo, OrganizationMemberRepo } from "@hazel/backend-core"
import { ErrorUtils, policy } from "@hazel/domain"
import type { ChannelId, ChannelMemberId } from "@hazel/schema"
import { Context, Effect, Layer, Option } from "effect"
import { isAdminOrOwner } from "../lib/policy-utils"
import { OrgResolver } from "../services/org-resolver"

export class ChannelMemberPolicy extends Context.Service<ChannelMemberPolicy>()(
	"ChannelMemberPolicy/Policy",
	{
		make: Effect.gen(function* () {
			const policyEntity = "ChannelMember" as const

			const channelMemberRepo = yield* ChannelMemberRepo
			const channelRepo = yield* ChannelRepo
			const organizationMemberRepo = yield* OrganizationMemberRepo
			const orgResolver = yield* OrgResolver

			const isOwner = (id: ChannelMemberId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"isOwner",
				)(
					channelMemberRepo.with(id, (member) =>
						policy(
							policyEntity,
							"isOwner",
							Effect.fn(`${policyEntity}.isOwner`)(function* (actor) {
								return yield* Effect.succeed(actor.id === member.userId)
							}),
						),
					),
				)

			const canCreate = (channelId: ChannelId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"create",
				)(
					channelRepo.with(channelId, (channel) =>
						policy(
							policyEntity,
							"create",
							Effect.fn(`${policyEntity}.create`)(function* (actor) {
								const orgMember = yield* organizationMemberRepo.findByOrgAndUser(
									channel.organizationId,
									actor.id,
								)

								if (Option.isSome(orgMember) && isAdminOrOwner(orgMember.value.role)) {
									return yield* Effect.succeed(true)
								}

								// For public channels, any org member can join
								if (channel.type === "public" && Option.isSome(orgMember)) {
									return yield* Effect.succeed(true)
								}

								return yield* Effect.succeed(false)
							}),
						),
					),
				)

			const canRead = (channelId: ChannelId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"select",
				)(
					channelRepo.with(channelId, (channel) =>
						policy(
							policyEntity,
							"select",
							Effect.fn(`${policyEntity}.select`)(function* (actor) {
								// Check if user is a member of the channel
								const membership = yield* channelMemberRepo.findByChannelAndUser(
									channelId,
									actor.id,
								)

								if (Option.isSome(membership)) {
									return yield* Effect.succeed(true)
								}

								// Organization admins can read all channel members
								const orgMember = yield* organizationMemberRepo.findByOrgAndUser(
									channel.organizationId,
									actor.id,
								)

								if (Option.isSome(orgMember) && isAdminOrOwner(orgMember.value.role)) {
									return yield* Effect.succeed(true)
								}

								return yield* Effect.succeed(false)
							}),
						),
					),
				)

			const canUpdate = (id: ChannelMemberId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"update",
				)(
					channelMemberRepo.with(id, (member) =>
						channelRepo.with(member.channelId, (channel) =>
							policy(
								policyEntity,
								"update",
								Effect.fn(`${policyEntity}.update`)(function* (actor) {
									// Self-update always allowed
									if (actor.id === member.userId) {
										return yield* Effect.succeed(true)
									}

									// Organization admins and owners can update any membership
									const orgMember = yield* organizationMemberRepo.findByOrgAndUser(
										channel.organizationId,
										actor.id,
									)

									if (Option.isSome(orgMember) && isAdminOrOwner(orgMember.value.role)) {
										return yield* Effect.succeed(true)
									}

									return yield* Effect.succeed(false)
								}),
							),
						),
					),
				)

			const canDelete = (id: ChannelMemberId) =>
				ErrorUtils.refailUnauthorized(
					policyEntity,
					"delete",
				)(
					channelMemberRepo.with(id, (member) =>
						channelRepo.with(member.channelId, (channel) =>
							policy(
								policyEntity,
								"delete",
								Effect.fn(`${policyEntity}.delete`)(function* (actor) {
									// Self-removal always allowed
									if (actor.id === member.userId) {
										return yield* Effect.succeed(true)
									}

									// Organization admins and owners can remove members
									const orgMember = yield* organizationMemberRepo.findByOrgAndUser(
										channel.organizationId,
										actor.id,
									)

									if (Option.isSome(orgMember) && isAdminOrOwner(orgMember.value.role)) {
										return yield* Effect.succeed(true)
									}

									return yield* Effect.succeed(false)
								}),
							),
						),
					),
				)

			return { canCreate, canRead, canUpdate, canDelete, isOwner } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ChannelMemberRepo.layer),
		Layer.provide(ChannelRepo.layer),
		Layer.provide(OrganizationMemberRepo.layer),
		Layer.provide(OrgResolver.layer),
	)
}
