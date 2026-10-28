/**
 * TODO(do-sync): runs in the OrgObject (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - after membership writes: `syncUserInOrganization` then `publishChannelAccess` per affected channel,
 *   `DirectoryEffects.upsertMembershipIndex`, `UserEffects.setOrganization` to the member's UserObject
 */
import { OrganizationMemberRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import {
	OrganizationMemberNotFoundError,
	OrganizationMemberResponse,
	OrganizationMemberRpcs,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { OrganizationMemberPolicy } from "../../policies/organization-member-policy"
import { ChannelAccessSyncService } from "../../services/channel-access-sync"

/**
 * Organization Member RPC Handlers
 *
 * Implements the business logic for all organization member-related RPC methods.
 * Each handler receives the payload and has access to CurrentUser via Effect context
 * (provided by AuthMiddleware).
 *
 * All handlers use:
 * - Database transactions for atomicity
 * - Policy checks for authorization
 * - Transaction IDs for optimistic updates
 * - Error remapping for consistent error handling
 */
export const OrganizationMemberRpcLive = OrganizationMemberRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const organizationMemberPolicy = yield* OrganizationMemberPolicy
		const organizationMemberRepo = yield* OrganizationMemberRepo
		const channelAccessSync = yield* ChannelAccessSyncService

		return {
			"organizationMember.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* organizationMemberPolicy.canCreate(payload.organizationId)
							const createdOrganizationMember = yield* organizationMemberRepo
								.insert({
									...payload,
									userId: user.id,
									deletedAt: null,
								})
								.pipe(Effect.map((res) => res[0]!))

							yield* channelAccessSync.syncUserInOrganization(
								createdOrganizationMember.userId,
								createdOrganizationMember.organizationId,
							)

							const txid = yield* generateTransactionId()

							return new OrganizationMemberResponse({
								data: createdOrganizationMember,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("OrganizationMember", "create")),

			"organizationMember.update": ({ id, organizationId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationMemberPolicy.canUpdate(id)
							const updatedOrganizationMember = yield* organizationMemberRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new OrganizationMemberResponse({
								data: updatedOrganizationMember,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("OrganizationMember", "update")),

			"organizationMember.updateMetadata": ({ id, metadata }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationMemberPolicy.canUpdate(id)
							const updatedOrganizationMemberOption =
								yield* organizationMemberRepo.updateMetadata(id, metadata)

							const updatedOrganizationMember = yield* Option.match(
								updatedOrganizationMemberOption,
								{
									onNone: () =>
										Effect.fail(
											new OrganizationMemberNotFoundError({
												organizationMemberId: id,
											}),
										),
									onSome: (member) => Effect.succeed(member),
								},
							)

							const txid = yield* generateTransactionId()

							return new OrganizationMemberResponse({
								data: updatedOrganizationMember,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("OrganizationMember", "update")),

			"organizationMember.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationMemberPolicy.canDelete(id)
							const deletedMemberOption = yield* organizationMemberRepo.findById(id)

							yield* organizationMemberRepo.deleteById(id)

							if (Option.isSome(deletedMemberOption)) {
								yield* channelAccessSync.syncUserInOrganization(
									deletedMemberOption.value.userId,
									deletedMemberOption.value.organizationId,
								)
							}

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("OrganizationMember", "delete")),
		}
	}),
)
