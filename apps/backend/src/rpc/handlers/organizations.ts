import { ChannelMemberRepo, ChannelRepo, OrganizationMemberRepo, OrganizationRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, InternalServerError, withRemapDbErrors } from "@hazel/domain"
import {
	AlreadyMemberError,
	OrganizationNotFoundError,
	OrganizationResponse,
	OrganizationRpcs,
	OrganizationSlugAlreadyExistsError,
	PublicInviteDisabledError,
	PublicOrganizationInfo,
} from "@hazel/domain/rpc"
import { OrganizationId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { currentObject } from "../../lib/current-object"
import { OrganizationPolicy } from "../../policies/organization-policy"
import { Directory } from "../../services/directory"
import { forwardRpc } from "../../worker/objects/forward"
import { orgTarget } from "../../worker/objects/kinds"
import { syncMemberAccess } from "../../worker/objects/org/channel-access"
import { publishOrgIndex, publishOrgRemoval } from "../../worker/objects/org/organization"
import { projectUsers } from "../../worker/objects/org/projections"

const UNKNOWN_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000000" as OrganizationId

const slugTaken = (slug: string) =>
	new OrganizationSlugAlreadyExistsError({
		message: `Organization slug '${slug}' is already taken`,
		slug,
	})

const toResponse = (
	organization: schema.Organization,
	transactionId: OrganizationResponse["transactionId"],
) =>
	new OrganizationResponse({
		data: {
			...organization,
			settings: organization.settings as { readonly [x: string]: unknown } | null,
		},
		transactionId,
	})

/** The object's own organization id; `None` on the directory path. */
const objectOrganizationId = Effect.map(currentObject, (object) =>
	Option.isSome(object) && object.value.kind === "org"
		? Option.some(OrganizationId.make(object.value.id))
		: Option.none<OrganizationId>(),
)

/**
 * Organization RPC handlers.
 *
 * - `organization.create` / `organization.joinViaPublicInvite` arrive on the directory path
 *   (`rpc/routing.ts`): the slug is resolved in `org_index` (D1), then the same RPC is forwarded
 *   to the `OrgObject` (`forwardRpc`), which writes its rows and projects them (membership,
 *   channel access, `org_index`, `user_organizations`) through its outbox.
 * - `organization.getBySlugPublic` answers from `org_index` and `membership_index` alone.
 * - update / delete / setSlug / setPublicMode run in the `OrgObject` and reproject `org_index`.
 *
 * Slugs are unique across objects only through `org_index`: a write checks it, so two orgs racing
 * for one slug can both win (accepted; the index keeps the last).
 */
export const OrganizationRpcLive = OrganizationRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const directory = yield* Directory
		const organizationRepo = yield* OrganizationRepo
		const organizationPolicy = yield* OrganizationPolicy
		const channelRepo = yield* ChannelRepo
		const channelMemberRepo = yield* ChannelMemberRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo

		/** `slug` belongs to another live organization than `self`. */
		const requireFreeSlug = (slug: string | null | undefined, self?: OrganizationId) =>
			Effect.gen(function* () {
				if (!slug) return
				const owner = yield* directory.orgBySlug(slug)
				if (Option.isSome(owner) && owner.value.id !== self) return yield* slugTaken(slug)
			})

		const localOrganization = (id: OrganizationId) =>
			db.first(
				SQLite.from(schema.organizationsTable)
					.select()
					.where(($) => [$.id.eq(id), $.deletedAt.isNull()])
					.limit(1),
			)

		/** Join the org as `role` (its `general` channel too) and project the membership. */
		const join = Effect.fn("Organization.join")(function* (
			organizationId: OrganizationId,
			role: "owner" | "member",
		) {
			const currentUser = yield* CurrentUser.Context
			yield* projectUsers([currentUser.id])
			yield* organizationMemberRepo.upsertByOrgAndUser({
				organizationId,
				userId: currentUser.id,
				role,
				nickname: undefined,
				joinedAt: new Date(),
				invitedBy: null,
				deletedAt: null,
			})
			return currentUser
		})

		/** Update the org row (after `check`) and reproject `org_index`. */
		const update = <E, R>(
			id: OrganizationId,
			patch: Parameters<typeof organizationRepo.update>[0],
			check: Effect.Effect<void, E, R>,
		) =>
			db.transaction(
				Effect.gen(function* () {
					yield* organizationPolicy.canUpdate(id)
					yield* check
					const updated = yield* organizationRepo.update(patch)
					yield* publishOrgIndex(id)
					return toResponse(updated, yield* generateTransactionId())
				}),
			)

		return {
			"organization.create": (payload) =>
				Effect.gen(function* () {
					const self = yield* objectOrganizationId
					if (Option.isNone(self)) {
						// Directory path: claim an id, then let the new OrgObject create itself.
						yield* requireFreeSlug(payload.slug)
						yield* organizationPolicy.canCreate()
						const id = OrganizationId.make(crypto.randomUUID())
						return yield* forwardRpc<
							OrganizationResponse,
							OrganizationSlugAlreadyExistsError | InternalServerError
						>(orgTarget(id), "organization.create", payload)
					}

					const id = self.value
					return yield* db.transaction(
						Effect.gen(function* () {
							const existing = yield* localOrganization(id)
							if (Option.isSome(existing)) {
								return yield* new InternalServerError({
									message: `Organization ${id} already exists`,
								})
							}
							yield* organizationPolicy.canCreate()
							const [created] = yield* db.run(
								SQLite.insertInto(schema.organizationsTable)
									.values({
										id,
										name: payload.name,
										slug: payload.slug,
										logoUrl: payload.logoUrl,
										settings: (payload.settings ?? null) as Record<
											string,
											unknown
										> | null,
										isPublic: false,
										deletedAt: null,
									})
									.returning(),
							)
							const owner = yield* join(id, "owner")
							yield* organizationRepo.setupDefaultChannels(id, owner.id)
							yield* syncMemberAccess(owner.id, id)
							yield* publishOrgIndex(id)
							return toResponse(created!, yield* generateTransactionId())
						}),
					)
				}).pipe(withRemapDbErrors("Organization", "create")),

			"organization.update": ({ id, ...payload }) =>
				update(id, { id, ...payload }, requireFreeSlug(payload.slug, id)).pipe(
					withRemapDbErrors("Organization", "update"),
				),

			"organization.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* organizationPolicy.canDelete(id)
							yield* organizationRepo.softDelete(id)
							// TODO(do-sync): cut the channels' viewers too (their ChannelObjects keep
							// serving sockets until the org's members change).
							yield* publishOrgRemoval(id)
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("Organization", "delete")),

			"organization.setSlug": ({ id, slug }) =>
				update(id, { id, slug }, requireFreeSlug(slug, id)).pipe(
					withRemapDbErrors("Organization", "update"),
				),

			"organization.setPublicMode": ({ id, isPublic }) =>
				update(id, { id, isPublic }, Effect.void).pipe(withRemapDbErrors("Organization", "update")),

			"organization.getBySlugPublic": ({ slug }) =>
				Effect.gen(function* () {
					const org = yield* directory.orgBySlug(slug)
					if (Option.isNone(org) || !org.value.isPublic) return null
					const memberCount = yield* directory.memberCount(org.value.id)
					// The logo lives with the org; the join page shows the initial without it.
					return new PublicOrganizationInfo({
						id: org.value.id,
						name: org.value.name,
						slug: org.value.slug,
						logoUrl: null,
						memberCount,
					})
				}).pipe(
					Effect.catchTag("DatabaseError", (cause) =>
						Effect.fail(
							new InternalServerError({ message: "Error fetching organization", cause }),
						),
					),
					Effect.withSpan("Organization.getBySlugPublic"),
				),

			"organization.joinViaPublicInvite": ({ slug }) =>
				Effect.gen(function* () {
					const self = yield* objectOrganizationId
					if (Option.isNone(self)) {
						const indexed = yield* directory.orgBySlug(slug)
						if (Option.isNone(indexed)) {
							return yield* new OrganizationNotFoundError({
								organizationId: UNKNOWN_ORGANIZATION_ID,
							})
						}
						return yield* forwardRpc<
							OrganizationResponse,
							OrganizationNotFoundError | PublicInviteDisabledError | AlreadyMemberError
						>(orgTarget(indexed.value.id), "organization.joinViaPublicInvite", { slug })
					}

					return yield* db.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							const orgOption = yield* localOrganization(self.value)
							if (Option.isNone(orgOption) || orgOption.value.slug !== slug) {
								return yield* new OrganizationNotFoundError({
									organizationId: UNKNOWN_ORGANIZATION_ID,
								})
							}
							const org = orgOption.value
							if (!org.isPublic) {
								return yield* new PublicInviteDisabledError({ organizationId: org.id })
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

							yield* join(org.id, "member")
							const general = yield* channelRepo.findByOrgAndName(org.id, "general")
							if (Option.isSome(general)) {
								yield* channelMemberRepo.insert({
									channelId: general.value.id,
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
							yield* syncMemberAccess(currentUser.id, org.id)
							return toResponse(org, yield* generateTransactionId())
						}),
					)
				}).pipe(withRemapDbErrors("Organization", "update")),
		}
	}),
)
