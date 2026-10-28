/**
 * Hazel Connect RPCs (shared channels between orgs), run in `OrgObject`s (`rpc/routing.ts`):
 *
 * - the host org: `invite.create` / `invite.revoke`, `settings.update`, host-side `member.*` and
 *   `organization.disconnect`;
 * - the guest org: `invite.accept` / `invite.decline`, guest-side `member.*` and leaving;
 * - the caller's org: `workspace.search` (D1 `org_index`), the invite lists (D1 `connect_invites`).
 *
 * Invites are the directory's; writes reach it through the outbox (`directory.upsertConnectInvite`).
 * What crosses between host and guest orgs is in `worker/objects/connect-wire.ts`; the org-side
 * logic in `worker/objects/org/connect.ts`.
 */
import { ChannelMemberRepo, ConnectInviteRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, PermissionError, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import {
	ChannelNotFoundError,
	ConnectChannelAlreadySharedError,
	ConnectConversationNotFoundError,
	ConnectConversationResponse,
	ConnectInviteInvalidStateError,
	ConnectInviteListResponse,
	ConnectInviteNotFoundError,
	ConnectInviteResponse,
	ConnectParticipantResponse,
	ConnectShareRpcs,
	ConnectWorkspaceNotFoundError,
	ConnectWorkspaceSearchResponse,
	ConnectWorkspaceSearchResult,
} from "@hazel/domain/rpc"
import type { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { currentObject } from "../../lib/current-object"
import { generateTransactionId } from "../../lib/create-transactionId"
import { Directory } from "../../services/directory"
import { OrgResolver } from "../../services/org-resolver"
import {
	ConnectDirectoryEffects,
	ConnectOrgEffects,
	toInviteWire,
	toMountWire,
} from "../../worker/objects/connect-wire"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { orgTarget } from "../../worker/objects/kinds"
import { syncChannelAccess } from "../../worker/objects/org/channel-access"
import { dropMountedSearch } from "../../worker/objects/org/message-search"
import {
	activeMountOf,
	conversationOf,
	endConversation,
	ensureConversation,
	mountsOf,
	participantIdFor,
	publishConversation,
	removeGuestOrg,
	upsertParticipant,
} from "../../worker/objects/org/connect"

export const resolveGuestOrganizationForInviteCreate = ({
	providedOrgId,
	target,
	findBySlug,
}: {
	providedOrgId: OrganizationId | undefined
	target: { kind: "slug"; value: string }
	findBySlug: (slug: string) => Effect.Effect<Option.Option<{ id: OrganizationId }>, any, any>
}) =>
	Effect.gen(function* () {
		if (target.kind !== "slug") {
			return providedOrgId ?? null
		}

		const orgOption = yield* findBySlug(target.value)
		if (Option.isNone(orgOption)) {
			return yield* Effect.fail(
				new ConnectWorkspaceNotFoundError({
					message: `No workspace found for slug '${target.value}'`,
				}),
			)
		}

		const resolvedOrganizationId = orgOption.value.id
		if (providedOrgId && providedOrgId !== resolvedOrganizationId) {
			return yield* Effect.fail(
				new ConnectWorkspaceNotFoundError({
					message: "The selected workspace does not match the invite target",
				}),
			)
		}

		return resolvedOrganizationId
	})

export const validateInviteAcceptanceTarget = ({
	invite,
	guestOrganizationId,
	findBySlug,
}: {
	invite: {
		targetKind: "slug" | "email"
		targetValue: string
		guestOrganizationId: OrganizationId | null
	}
	guestOrganizationId: OrganizationId
	findBySlug: (slug: string) => Effect.Effect<Option.Option<{ id: OrganizationId }>, any, any>
}) =>
	Effect.gen(function* () {
		if (invite.guestOrganizationId && invite.guestOrganizationId !== guestOrganizationId) {
			return yield* Effect.fail(
				new ConnectWorkspaceNotFoundError({
					message: "This invite targets a different workspace",
				}),
			)
		}

		if (invite.targetKind === "email") {
			if (!invite.guestOrganizationId) {
				return yield* Effect.fail(
					new ConnectWorkspaceNotFoundError({
						message: "This invite is not bound to a workspace",
					}),
				)
			}
			return
		}

		const orgOption = yield* findBySlug(invite.targetValue)
		if (Option.isNone(orgOption) || orgOption.value.id !== guestOrganizationId) {
			return yield* Effect.fail(
				new ConnectWorkspaceNotFoundError({
					message: "This invite targets a different workspace",
				}),
			)
		}
	})

export const assertGuestMemberAddsAllowed = (
	mount: {
		role: "host" | "guest"
		allowGuestMemberAdds: boolean
	} | null,
) =>
	mount?.role === "guest" && !mount.allowGuestMemberAdds
		? Effect.fail(
				new PermissionError({
					message: "This guest workspace cannot add members to the shared channel",
					requiredScope: "channel-members:write",
				}),
			)
		: Effect.void

function remapPermissionError<A, E, R>(
	make: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, PermissionError> | UnauthorizedError, R> {
	return Effect.catchIf(
		make,
		(error): error is E & PermissionError => PermissionError.is(error),
		(err) =>
			Effect.fail(
				new UnauthorizedError({
					message: err.message,
					detail: err.requiredScope ?? "",
				}),
			),
	) as Effect.Effect<A, Exclude<E, PermissionError> | UnauthorizedError, R>
}

const conversationNotFound = (conversationId?: ConnectConversationId) =>
	new ConnectConversationNotFoundError({
		...(conversationId === undefined ? {} : { conversationId }),
		message: "Hazel Connect conversation not found",
	})

/** The invite rows, over D1. */
const inviteRepo = Effect.flatMap(Directory, (directory) =>
	ConnectInviteRepo.make.pipe(Effect.provideService(Database.Database, directory.db)),
)

const findInvite = (inviteId: ConnectInviteId) =>
	Effect.flatMap(inviteRepo, (repo) => repo.findActiveById(inviteId)).pipe(
		Effect.flatMap(
			Option.match({
				onNone: () =>
					Effect.fail(
						new ConnectInviteNotFoundError({
							inviteId,
							message: "Hazel Connect invite not found",
						}),
					),
				onSome: Effect.succeed,
			}),
		),
	)

const findBySlug = (slug: string) => Effect.flatMap(Directory, (directory) => directory.orgBySlug(slug))

/** The org this call runs in; `None` on the directory path (an unrouted id). */
const currentOrgId = Effect.map(currentObject, (object) =>
	Option.isSome(object) && object.value.kind === "org"
		? Option.some(object.value.id as OrganizationId)
		: Option.none<OrganizationId>(),
)

const writeInvite = (row: schema.ConnectInvite) =>
	enqueueEffect(ConnectDirectoryEffects.upsertInvite, { kind: "directory" }, toInviteWire(row))

export const ConnectShareRpcLive = ConnectShareRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const orgResolver = yield* OrgResolver
		const channelMemberRepo = yield* ChannelMemberRepo

		const requireAdminOrOwner = (organizationId: OrganizationId) =>
			orgResolver.requireAdminOrOwner(organizationId, "organizations:write", "ConnectShare", "manage")

		const findChannel = (channelId: ChannelId) =>
			db
				.first(
					SQLite.from(schema.channelsTable)
						.select()
						.where(($) => [$.id.eq(channelId), $.deletedAt.isNull()])
						.limit(1),
				)
				.pipe(
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.fail(new ChannelNotFoundError({ channelId })),
							onSome: Effect.succeed,
						}),
					),
				)

		const isMemberOf = (organizationId: OrganizationId, userId: UserId) =>
			db
				.first(
					SQLite.from(schema.organizationMembersTable)
						.select("id")
						.where(($) => [
							$.organizationId.eq(organizationId),
							$.userId.eq(userId),
							$.deletedAt.isNull(),
						])
						.limit(1),
				)
				.pipe(Effect.map(Option.isSome))

		/** Join `userId` to `channelId` (or bring a removed membership back). */
		const ensureChannelMember = Effect.fn("ConnectShare.ensureChannelMember")(function* (
			channelId: ChannelId,
			userId: UserId,
		) {
			const existing = yield* channelMemberRepo.findByChannelAndUser(channelId, userId)
			if (Option.isSome(existing)) return
			yield* db.run(
				SQLite.insertInto(schema.channelMembersTable).values({
					channelId,
					userId,
					joinedAt: new Date(),
				}),
			)
		})

		return {
			"connectShare.workspace.search": ({ query, organizationId }) =>
				Effect.gen(function* () {
					yield* orgResolver.requireScope(
						organizationId,
						"organizations:read",
						"ConnectShare",
						"workspace.search",
					)
					const directory = yield* Directory
					const pattern = `%${query}%`
					const results = yield* directory.db.run(
						SQLite.from(schema.orgIndexTable)
							.select("id", "name", "slug")
							.where(($) => [
								$.deletedAt.isNull(),
								$.isPublic.eq(true),
								$.id.neq(organizationId),
								$.name.like(pattern).or($.slug.like(pattern)),
							])
							.limit(10),
					)
					return new ConnectWorkspaceSearchResponse({
						// The directory's org index carries no logo.
						data: results.map(
							(row) => new ConnectWorkspaceSearchResult({ ...row, logoUrl: null }),
						),
					})
				}).pipe(
					withRemapDbErrors("ConnectShare", "select"),
					remapPermissionError,
					Effect.withSpan("ConnectShare.workspaceSearch"),
				),

			"connectShare.invite.create": ({
				channelId,
				guestOrganizationId: providedOrgId,
				target,
				allowGuestMemberAdds,
			}) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							const channel = yield* findChannel(channelId)
							yield* requireAdminOrOwner(channel.organizationId)
							const existing = yield* activeMountOf(channel.id)
							if (Option.isSome(existing) && existing.value.role === "guest") {
								return yield* new PermissionError({
									message: "Only the host workspace can invite others to a shared channel",
									requiredScope: "organizations:write",
								})
							}

							const guestOrganization = yield* resolveGuestOrganizationForInviteCreate({
								providedOrgId,
								target,
								findBySlug,
							})
							if (guestOrganization === channel.organizationId) {
								return yield* new ConnectWorkspaceNotFoundError({
									message: "A channel cannot be shared with its own workspace",
								})
							}

							const { conversation } = yield* ensureConversation(channel, currentUser.id)
							if (guestOrganization !== null) {
								const mounted = (yield* mountsOf(conversation.id)).some(
									(mount) =>
										mount.organizationId === guestOrganization &&
										mount.isActive &&
										mount.deletedAt === null,
								)
								if (mounted) {
									return yield* new ConnectChannelAlreadySharedError({
										channelId,
										organizationId: guestOrganization,
										message: "This channel is already shared with that workspace",
									})
								}
							}
							// The channel's object learns its conversation (and tags earlier messages).
							yield* syncChannelAccess(channel.id)

							const now = new Date()
							const invite: schema.ConnectInvite = {
								id: crypto.randomUUID() as ConnectInviteId,
								conversationId: conversation.id,
								hostOrganizationId: channel.organizationId,
								hostChannelId: channel.id,
								targetKind: target.kind,
								targetValue: target.value,
								guestOrganizationId: guestOrganization,
								status: "pending",
								allowGuestMemberAdds,
								invitedBy: currentUser.id,
								acceptedBy: null,
								acceptedAt: null,
								expiresAt: null,
								createdAt: now,
								updatedAt: now,
								deletedAt: null,
							}
							yield* writeInvite(invite)

							const txid = yield* generateTransactionId()
							return new ConnectInviteResponse({ data: invite, transactionId: txid })
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "create"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.inviteCreate", {
							attributes: { "channel.id": channelId },
						}),
					),

			"connectShare.invite.accept": ({ inviteId, guestOrganizationId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							yield* requireAdminOrOwner(guestOrganizationId)
							const invite = yield* findInvite(inviteId)
							if (invite.status !== "pending") {
								return yield* new ConnectInviteInvalidStateError({
									inviteId,
									status: invite.status,
									message: "Only pending Hazel Connect invites can be accepted",
								})
							}
							yield* validateInviteAcceptanceTarget({ invite, guestOrganizationId, findBySlug })
							if (invite.hostOrganizationId === guestOrganizationId) {
								return yield* new ConnectWorkspaceNotFoundError({
									message: "This invite targets a different workspace",
								})
							}

							const existing = (yield* mountsOf(invite.conversationId)).find(
								(mount) =>
									mount.organizationId === guestOrganizationId &&
									mount.isActive &&
									mount.deletedAt === null,
							)
							if (existing !== undefined) {
								return yield* new ConnectChannelAlreadySharedError({
									channelId: existing.channelId,
									organizationId: guestOrganizationId,
									message: "This workspace is already connected to the conversation",
								})
							}

							const now = new Date()
							// Private until the host's snapshot brings the host channel's name and type.
							const guestChannelId = crypto.randomUUID() as ChannelId
							yield* db.run(
								SQLite.insertInto(schema.channelsTable).values({
									id: guestChannelId,
									name: "shared-channel",
									icon: null,
									type: "private",
									organizationId: guestOrganizationId,
									parentChannelId: null,
									sectionId: null,
								}),
							)
							yield* ensureChannelMember(guestChannelId, currentUser.id)

							const conversation: schema.ConnectConversation = {
								id: invite.conversationId,
								hostOrganizationId: invite.hostOrganizationId,
								hostChannelId: invite.hostChannelId,
								status: "active",
								settings: null,
								createdBy: invite.invitedBy,
								createdAt: now,
								updatedAt: now,
								deletedAt: null,
							}
							yield* db.run(
								SQLite.insertInto(schema.connectConversationsTable)
									.values(conversation)
									.onConflictDoUpdate({
										target: ["id"],
										set: { status: "active", deletedAt: null, updatedAt: now },
									}),
							)
							const mount: schema.ConnectConversationChannel = {
								id: crypto.randomUUID() as schema.ConnectConversationChannel["id"],
								conversationId: invite.conversationId,
								organizationId: guestOrganizationId,
								channelId: guestChannelId,
								role: "guest",
								allowGuestMemberAdds: invite.allowGuestMemberAdds,
								isActive: true,
								createdAt: now,
								updatedAt: now,
								deletedAt: null,
							}
							yield* db.run(
								SQLite.insertInto(schema.connectConversationChannelsTable).values(mount),
							)

							// Host first: it accepts this org's participants only once mounted.
							yield* enqueueEffect(
								ConnectOrgEffects.mountAdded,
								orgTarget(invite.hostOrganizationId),
								{ mount: toMountWire(mount) },
							)
							// The mount's access: its index row names the host channel, its readers
							// become the host's participants.
							yield* syncChannelAccess(guestChannelId)
							yield* writeInvite({
								...invite,
								status: "accepted",
								guestOrganizationId,
								acceptedBy: currentUser.id,
								acceptedAt: now,
								updatedAt: now,
							})

							const txid = yield* generateTransactionId()
							return new ConnectConversationResponse({
								data: conversation,
								transactionId: txid,
							})
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "create"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.inviteAccept", {
							attributes: { "connect.invite_id": inviteId },
						}),
					),

			"connectShare.invite.decline": ({ inviteId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const invite = yield* findInvite(inviteId)
							if (invite.status !== "pending") {
								return yield* new ConnectInviteInvalidStateError({
									inviteId,
									status: invite.status,
									message: "Only pending Hazel Connect invites can be declined",
								})
							}
							if (!invite.guestOrganizationId) {
								return yield* new ConnectWorkspaceNotFoundError({
									message: "This invite is not bound to a workspace",
								})
							}
							yield* requireAdminOrOwner(invite.guestOrganizationId)
							yield* writeInvite({ ...invite, status: "declined", updatedAt: new Date() })
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "update"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.inviteDecline"),
					),

			"connectShare.invite.revoke": ({ inviteId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const invite = yield* findInvite(inviteId)
							yield* requireAdminOrOwner(invite.hostOrganizationId)
							if (invite.status !== "pending") {
								return yield* new ConnectInviteInvalidStateError({
									inviteId,
									status: invite.status,
									message: "Only pending Hazel Connect invites can be revoked",
								})
							}
							yield* writeInvite({ ...invite, status: "revoked", updatedAt: new Date() })
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "update"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.inviteRevoke"),
					),

			"connectShare.invite.listIncoming": ({ organizationId }) =>
				Effect.gen(function* () {
					yield* orgResolver.requireScope(
						organizationId,
						"organizations:read",
						"ConnectShare",
						"listIncoming",
					)
					const repo = yield* inviteRepo
					return new ConnectInviteListResponse({
						data: yield* repo.listIncomingForOrganization(organizationId),
					})
				}).pipe(withRemapDbErrors("ConnectShare", "select"), remapPermissionError),

			"connectShare.invite.listOutgoing": ({ organizationId }) =>
				Effect.gen(function* () {
					yield* orgResolver.requireScope(
						organizationId,
						"organizations:read",
						"ConnectShare",
						"listOutgoing",
					)
					const repo = yield* inviteRepo
					return new ConnectInviteListResponse({
						data: yield* repo.listOutgoingForOrganization(organizationId),
					})
				}).pipe(withRemapDbErrors("ConnectShare", "select"), remapPermissionError),

			"connectShare.settings.update": ({ conversationId, allowGuestMemberAdds, status }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const here = yield* currentOrgId
							const conversation = Option.isNone(here)
								? Option.none()
								: yield* conversationOf(conversationId)
							if (Option.isNone(conversation) || Option.isNone(here)) {
								return yield* conversationNotFound(conversationId)
							}
							yield* requireAdminOrOwner(conversation.value.hostOrganizationId)
							const now = new Date()
							const updated: schema.ConnectConversation = {
								...conversation.value,
								status: status ?? conversation.value.status,
								updatedAt: now,
							}
							yield* db.run(
								SQLite.update(schema.connectConversationsTable)
									.set({ status: updated.status, updatedAt: now })
									.where(($) => [$.id.eq(conversationId)]),
							)
							if (allowGuestMemberAdds !== undefined) {
								yield* db.run(
									SQLite.update(schema.connectConversationChannelsTable)
										.set({ allowGuestMemberAdds, updatedAt: now })
										.where(($) => [
											$.conversationId.eq(conversationId),
											$.role.eq("guest"),
										]),
								)
							}
							yield* publishConversation(conversationId)
							const txid = yield* generateTransactionId()
							return new ConnectConversationResponse({ data: updated, transactionId: txid })
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "update"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.settingsUpdate"),
					),

			"connectShare.member.add": ({ channelId, userId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							const channel = yield* findChannel(channelId)
							yield* orgResolver.fromChannel(
								channelId,
								"channel-members:write",
								"ConnectShare",
								"member.add",
							)
							const mount = yield* activeMountOf(channelId)
							if (Option.isNone(mount)) {
								return yield* new ConnectConversationNotFoundError({
									message: "This channel is not shared through Hazel Connect",
								})
							}
							yield* assertGuestMemberAddsAllowed(mount.value)
							if (!(yield* isMemberOf(channel.organizationId, userId))) {
								return yield* new ConnectWorkspaceNotFoundError({
									message: "Only members of the current workspace can be added here",
								})
							}
							yield* ensureChannelMember(channelId, userId)
							const { conversationId } = mount.value
							if (mount.value.role === "host") {
								yield* upsertParticipant({
									conversationId,
									channelId,
									userId,
									homeOrganizationId: channel.organizationId,
									isExternal: false,
									addedBy: currentUser.id,
								})
							}
							// Host: the channel's viewers; guest: its readers, reported to the host.
							yield* syncChannelAccess(channelId)

							const now = new Date()
							const participant: schema.ConnectParticipant = {
								id: yield* participantIdFor(conversationId, userId),
								conversationId,
								channelId,
								userId,
								homeOrganizationId: channel.organizationId,
								isExternal: mount.value.role === "guest",
								addedBy: currentUser.id,
								createdAt: now,
								updatedAt: now,
								deletedAt: null,
							}
							const txid = yield* generateTransactionId()
							return new ConnectParticipantResponse({ data: participant, transactionId: txid })
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "create"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.memberAdd", {
							attributes: { "channel.id": channelId },
						}),
					),

			"connectShare.member.remove": ({ channelId, userId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const channel = yield* findChannel(channelId)
							yield* orgResolver.fromChannel(
								channelId,
								"channel-members:write",
								"ConnectShare",
								"member.remove",
							)
							if (!(yield* isMemberOf(channel.organizationId, userId))) {
								return yield* new ConnectWorkspaceNotFoundError({
									message: "Only members of the current workspace can be removed here",
								})
							}
							const membership = yield* channelMemberRepo.findByChannelAndUser(
								channelId,
								userId,
							)
							if (Option.isSome(membership)) {
								yield* channelMemberRepo.deleteById(membership.value.id)
							}
							const mount = yield* activeMountOf(channelId)
							if (Option.isSome(mount) && mount.value.role === "host") {
								const id = yield* participantIdFor(mount.value.conversationId, userId)
								yield* db.run(
									SQLite.update(schema.connectParticipantsTable)
										.set({ deletedAt: new Date(), updatedAt: new Date() })
										.where(($) => [$.id.eq(id), $.deletedAt.isNull()]),
								)
							}
							yield* syncChannelAccess(channelId)
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "delete"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.memberRemove", {
							attributes: { "channel.id": channelId },
						}),
					),

			"connectShare.organization.disconnect": ({ conversationId, organizationId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const here = yield* currentOrgId
							const conversation = Option.isNone(here)
								? Option.none()
								: yield* conversationOf(conversationId)
							if (Option.isNone(conversation) || Option.isNone(here)) {
								return yield* conversationNotFound(conversationId)
							}
							const { hostOrganizationId } = conversation.value

							if (here.value === hostOrganizationId) {
								// The host ends it, or takes a guest out (host admins only).
								yield* requireAdminOrOwner(hostOrganizationId)
								if (organizationId === hostOrganizationId)
									yield* endConversation(conversationId)
								else yield* removeGuestOrg(conversationId, organizationId)
							} else {
								// A guest leaves (its own admins).
								if (organizationId !== here.value)
									return yield* conversationNotFound(conversationId)
								yield* requireAdminOrOwner(organizationId)
								const now = new Date()
								const mounts = yield* db.run(
									SQLite.from(schema.connectConversationChannelsTable)
										.select("channelId")
										.where(($) => [
											$.conversationId.eq(conversationId),
											$.organizationId.eq(organizationId),
											$.deletedAt.isNull(),
										]),
								)
								yield* db.run(
									SQLite.update(schema.connectConversationChannelsTable)
										.set({ isActive: false, deletedAt: now, updatedAt: now })
										.where(($) => [
											$.conversationId.eq(conversationId),
											$.organizationId.eq(organizationId),
										]),
								)
								yield* enqueueEffect(
									ConnectOrgEffects.mountRemoved,
									orgTarget(hostOrganizationId),
									{
										conversationId,
										organizationId,
									},
								)
								// The mounted channel is the org's own again (its index row, its object), and
								// the host channel's messages leave this org's search.
								yield* Effect.forEach(
									mounts,
									(mount) =>
										Effect.andThen(
											syncChannelAccess(mount.channelId),
											dropMountedSearch(mount.channelId),
										),
									{ discard: true },
								)
							}
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(
						withRemapDbErrors("ConnectShare", "delete"),
						remapPermissionError,
						Effect.withSpan("ConnectShare.organizationDisconnect", {
							attributes: { "connect.conversation_id": conversationId },
						}),
					),
		}
	}),
)
