/**
 * TODO(do-sync): runs in the OrgObject (create/getBySlug/join: directory) (`rpc/routing.ts`); not ported
 * yet. To port: touch only that store's tables and send everything else through the outbox
 * (`worker/objects/effects`).
 * - `organization.create` must seed the new OrgObject (invoke it) and write `org_index`; slug lookups read
 *   `org_index`
 * - update/delete: `DirectoryEffects.upsertOrgIndex`
 */
import type { OrganizationId } from "@hazel/schema"
import { ChannelMemberRepo, ChannelRepo, OrganizationMemberRepo, OrganizationRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, InternalServerError, withRemapDbErrors } from "@hazel/domain"
import {
	AlreadyMemberError,
	OrganizationNotFoundError,
	OrganizationResponse,
	OrganizationRpcs,
	OrganizationSlugAlreadyExistsError,
	PublicInviteDisabledError,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { OrganizationPolicy } from "../../policies/organization-policy"
import { ChannelAccessSyncService } from "../../services/channel-access-sync"

const UNKNOWN_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000000" as OrganizationId

/** A unique violation on the slug: someone else has it. */
const isSlugTaken = (error: unknown): error is Database.DatabaseError =>
	error instanceof Database.DatabaseError &&
	error.type === "unique_violation" &&
	error.constraint === "organizations_slug_unique"

const slugTaken = (slug: string) =>
	new OrganizationSlugAlreadyExistsError({
		message: `Organization slug '${slug}' is already taken`,
		slug,
	})

/**
 * `withRemapDbErrors` for organization writes, except that a duplicate slug becomes
 * `OrganizationSlugAlreadyExistsError`.
 */
const handleOrganizationDbErrors =
	(entityType: string, action: "update" | "create", slug: string | null | undefined) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.mapError((error) => (isSlugTaken(error) ? slugTaken(slug ?? "unknown") : error)),
			withRemapDbErrors(entityType, action),
		)

/**
 * Organization RPC Handlers
 *
 * Implements the business logic for all organization-related RPC methods.
 * Each handler receives the payload and has access to CurrentUser via Effect context
 * (provided by AuthMiddleware).
 *
 * All handlers use:
 * - Database transactions for atomicity
 * - Policy checks for authorization
 * - Transaction IDs for optimistic updates
 * - Error remapping for consistent error handling including slug uniqueness violations
 */
export const OrganizationRpcLive = OrganizationRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const organizationRepo = yield* OrganizationRepo
		const organizationPolicy = yield* OrganizationPolicy
		const channelRepo = yield* ChannelRepo
		const channelMemberRepo = yield* ChannelMemberRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo
		const channelAccessSync = yield* ChannelAccessSyncService

		return {
			"organization.create": (payload) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context

					if (payload.slug) {
						const existingOrganization = yield* organizationRepo.findBySlug(payload.slug)

						if (Option.isSome(existingOrganization)) {
							return yield* Effect.fail(
								new OrganizationSlugAlreadyExistsError({
									message: `Organization slug '${payload.slug}' is already taken`,
									slug: payload.slug,
								}),
							)
						}
					}

					yield* organizationPolicy.canCreate()

					return yield* db.transaction(
						Effect.gen(function* () {
							const createdOrganization = yield* organizationRepo
								.insert({
									name: payload.name,
									slug: payload.slug,
									logoUrl: payload.logoUrl,
									settings: payload.settings ?? null,
									isPublic: false,
									deletedAt: null,
								})
								.pipe(Effect.map((res) => res[0]!))

							yield* organizationMemberRepo.upsertByOrgAndUser({
								organizationId: createdOrganization.id,
								userId: currentUser.id,
								role: "owner",
								nickname: undefined,
								joinedAt: new Date(),
								invitedBy: null,
								deletedAt: null,
							})

							// Setup default channels for the organization
							yield* organizationRepo.setupDefaultChannels(
								createdOrganization.id,
								currentUser.id,
							)

							yield* channelAccessSync.syncUserInOrganization(
								currentUser.id,
								createdOrganization.id,
							)

							const txid = yield* generateTransactionId()

							return new OrganizationResponse({
								data: {
									...createdOrganization,
									settings: createdOrganization.settings as {
										readonly [x: string]: unknown
									} | null,
								},
								transactionId: txid,
							})
						}),
					)
				}).pipe(handleOrganizationDbErrors("Organization", "create", payload.slug)),

			"organization.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* Effect.logInfo("organizationRepo.update", payload)
							yield* organizationPolicy.canUpdate(id)
							const updatedOrganization = yield* organizationRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new OrganizationResponse({
								data: {
									...updatedOrganization,
									settings: updatedOrganization.settings as {
										readonly [x: string]: unknown
									} | null,
								},
								transactionId: txid,
							})
						}),
					)
					.pipe(handleOrganizationDbErrors("Organization", "update", payload.slug)),

			"organization.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationPolicy.canDelete(id)
							yield* organizationRepo.deleteById(id)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Organization", "delete")),

			"organization.setSlug": ({ id, slug }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationPolicy.canUpdate(id)
							const updatedOrganization = yield* organizationRepo.update({
								id,
								slug,
							})

							const txid = yield* generateTransactionId()

							return new OrganizationResponse({
								data: {
									...updatedOrganization,
									settings: updatedOrganization.settings as {
										readonly [x: string]: unknown
									} | null,
								},
								transactionId: txid,
							})
						}),
					)
					.pipe(handleOrganizationDbErrors("Organization", "update", slug)),

			"organization.setPublicMode": ({ id, isPublic }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationPolicy.canUpdate(id)
							const updatedOrganization = yield* organizationRepo.update({
								id,
								isPublic,
							})

							const txid = yield* generateTransactionId()

							return new OrganizationResponse({
								data: {
									...updatedOrganization,
									settings: updatedOrganization.settings as {
										readonly [x: string]: unknown
									} | null,
								},
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Organization", "update")),

			"organization.getBySlugPublic": ({ slug }) =>
				Effect.gen(function* () {
					const orgOption = yield* organizationRepo.findBySlugIfPublic(slug)

					if (Option.isNone(orgOption)) {
						return null
					}

					const org = orgOption.value

					// Count members for this organization
					const memberCount = yield* organizationMemberRepo.countByOrganization(org.id)

					return {
						id: org.id,
						name: org.name,
						slug: org.slug,
						logoUrl: org.logoUrl,
						memberCount,
					}
				}).pipe(
					Effect.catchTags({
						DatabaseError: (err) =>
							Effect.fail(
								new InternalServerError({
									message: "Error fetching organization",
									cause: err,
								}),
							),
					}),
				),

			"organization.joinViaPublicInvite": ({ slug }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context

							const orgOption = yield* organizationRepo.findBySlug(slug)

							if (Option.isNone(orgOption)) {
								return yield* new OrganizationNotFoundError({
									organizationId: UNKNOWN_ORGANIZATION_ID,
								})
							}

							const org = orgOption.value

							if (!org.isPublic) {
								return yield* new PublicInviteDisabledError({
									organizationId: org.id,
								})
							}

							const existingMember = yield* organizationMemberRepo.findByOrgAndUser(
								org.id,
								currentUser.id,
							)

							if (Option.isSome(existingMember)) {
								return yield* new AlreadyMemberError({
									organizationId: org.id,
									organizationSlug: org.slug,
								})
							}

							yield* organizationMemberRepo.upsertByOrgAndUser({
								organizationId: org.id,
								userId: currentUser.id,
								role: "member",
								nickname: undefined,
								joinedAt: new Date(),
								invitedBy: null,
								deletedAt: null,
							})

							// Add user to the default "general" channel
							const generalChannel = yield* channelRepo.findByOrgAndName(org.id, "general")

							if (Option.isSome(generalChannel)) {
								yield* channelMemberRepo.insert({
									channelId: generalChannel.value.id,
									userId: currentUser.id,
									isHidden: false,
									isMuted: false,
									isFavorite: false,
									lastSeenMessageId: null,
									notificationCount: 0,
									joinedAt: new Date(),
									deletedAt: null,
								})
							}

							yield* channelAccessSync.syncUserInOrganization(currentUser.id, org.id)

							const txid = yield* generateTransactionId()

							return new OrganizationResponse({
								data: {
									...org,
									settings: org.settings as {
										readonly [x: string]: unknown
									} | null,
								},
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("Organization", "update")),
		}
	}),
)
