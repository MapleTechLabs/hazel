/**
 * TODO(do-sync): runs in the host OrgObject (directory for invites) (`rpc/routing.ts`); not ported yet. To
 * port: touch only that store's tables and send everything else through the outbox
 * (`worker/objects/effects`).
 * - invites are directory rows (no transactions); accept fans out: guest mount in the guest OrgObject,
 *   participants in the host OrgObject, `channel_index.hostChannelId` for the mount
 * - `ChannelViewers.require` must accept guest mounts routed to the host channel
 */
import {
	ChannelMemberRepo,
	ChannelRepo,
	ConnectConversationChannelRepo,
	ConnectConversationRepo,
	ConnectInviteRepo,
	ConnectParticipantRepo,
	OrganizationMemberRepo,
	OrganizationRepo,
} from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import {
	CurrentUser,
	InternalServerError,
	PermissionError,
	UnauthorizedError,
	withRemapDbErrors,
} from "@hazel/domain"
import {
	ChannelNotFoundError,
	ConnectChannelAlreadySharedError,
	ConnectConversationNotFoundError,
	ConnectConversationResponse,
	ConnectInviteInvalidStateError,
	ConnectInviteListResponse,
	ConnectInviteNotFoundError,
	ConnectInviteResponse,
	ConnectShareRpcs,
	ConnectWorkspaceNotFoundError,
	ConnectWorkspaceSearchResponse,
	ConnectWorkspaceSearchResult,
	ConnectParticipantResponse,
} from "@hazel/domain/rpc"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { ChannelAccessSyncService } from "../../services/channel-access-sync"
import { ConnectConversationService } from "../../services/connect-conversation-service"
import { OrgResolver } from "../../services/org-resolver"

const isUniqueViolation = (error: Database.DatabaseError, constraintName: string) =>
	error.type === "unique_violation" && error.constraint === constraintName

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

export const remapGuestMountInsertConflict = <E, R>({
	error,
	guestOrganizationId,
	findExistingMount,
}: {
	error: Database.DatabaseError
	guestOrganizationId: OrganizationId
	findExistingMount: () => Effect.Effect<Option.Option<{ channelId: ChannelId }>, E, R>
}): Effect.Effect<never, Database.DatabaseError | ConnectChannelAlreadySharedError | E, R> => {
	if (!isUniqueViolation(error, "connect_conv_channels_conversation_org_unique")) {
		return Effect.fail(error)
	}

	return findExistingMount().pipe(
		Effect.flatMap((existingMount) =>
			Effect.fail(
				Option.match(existingMount, {
					onNone: (): Database.DatabaseError | ConnectChannelAlreadySharedError => error,
					onSome: (mount) =>
						new ConnectChannelAlreadySharedError({
							channelId: mount.channelId,
							organizationId: guestOrganizationId,
							message: "This workspace is already connected to the conversation",
						}),
				}),
			),
		),
	)
}

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

export const ConnectShareRpcLive = ConnectShareRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const orgRepo = yield* OrganizationRepo
		const orgMemberRepo = yield* OrganizationMemberRepo
		const channelRepo = yield* ChannelRepo
		const channelMemberRepo = yield* ChannelMemberRepo
		const connectConversationRepo = yield* ConnectConversationRepo
		const connectConversationChannelRepo = yield* ConnectConversationChannelRepo
		const connectInviteRepo = yield* ConnectInviteRepo
		const connectParticipantRepo = yield* ConnectParticipantRepo
		const connectConversationService = yield* ConnectConversationService
		const orgResolver = yield* OrgResolver
		const channelAccessSync = yield* ChannelAccessSyncService

		const requireAdminOrOwner = (organizationId: OrganizationId) =>
			orgResolver.requireAdminOrOwner(organizationId, "organizations:write", "ConnectShare", "manage")

		const requireDisconnectAuthority = Effect.fn("ConnectShare.requireDisconnectAuthority")(function* (
			hostOrganizationId: OrganizationId,
			targetOrganizationId: OrganizationId,
		) {
			if (targetOrganizationId === hostOrganizationId) {
				yield* requireAdminOrOwner(hostOrganizationId)
				return
			}

			const hostAttempt = yield* requireAdminOrOwner(hostOrganizationId).pipe(Effect.result)
			if (hostAttempt._tag === "Success") return

			yield* requireAdminOrOwner(targetOrganizationId)
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
					const results = yield* db.run(
						SQLite.from(schema.organizationsTable)
							.select("id", "name", "slug", "logoUrl")
							.where(($) => [
								$.deletedAt.isNull(),
								$.isPublic.eq(true),
								$.name.like(`%${query}%`).or($.slug.like(`%${query}%`)),
							])
							.limit(10),
					)

					const filtered = results.filter((result) => result.id !== organizationId)

					return new ConnectWorkspaceSearchResponse({
						data: filtered.map((r) => new ConnectWorkspaceSearchResult(r)),
					})
				}).pipe(withRemapDbErrors("ConnectShare", "select"), remapPermissionError),

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
							const channelOption = yield* channelRepo.findById(channelId)
							if (Option.isNone(channelOption)) {
								return yield* Effect.fail(new ChannelNotFoundError({ channelId: channelId }))
							}
							const channel = channelOption.value
							yield* requireAdminOrOwner(channel.organizationId)

							const mount = yield* connectConversationService.ensureChannelConversation(
								channel.id,
								currentUser.id,
							)

							const guestOrganization = yield* resolveGuestOrganizationForInviteCreate({
								providedOrgId,
								target,
								findBySlug: orgRepo.findBySlug,
							})

							if (guestOrganization) {
								const existingMount =
									yield* connectConversationChannelRepo.findByConversationAndOrganization(
										mount.conversationId,
										guestOrganization,
									)
								if (Option.isSome(existingMount)) {
									return yield* Effect.fail(
										new ConnectChannelAlreadySharedError({
											channelId,
											organizationId: guestOrganization,
											message: "This channel is already shared with that workspace",
										}),
									)
								}
							}

							const invite = yield* connectInviteRepo
								.insert({
									conversationId: mount.conversationId,
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
									deletedAt: null,
								})
								.pipe(Effect.map((results) => results[0]!))

							const txid = yield* generateTransactionId()
							return new ConnectInviteResponse({ data: invite, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "create"), remapPermissionError),

			"connectShare.invite.accept": ({ inviteId, guestOrganizationId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							yield* requireAdminOrOwner(guestOrganizationId)

							const inviteOption = yield* connectInviteRepo.findActiveById(inviteId)
							if (Option.isNone(inviteOption)) {
								return yield* Effect.fail(
									new ConnectInviteNotFoundError({
										inviteId,
										message: "Hazel Connect invite not found",
									}),
								)
							}
							const invite = inviteOption.value

							if (invite.status !== "pending") {
								return yield* Effect.fail(
									new ConnectInviteInvalidStateError({
										inviteId,
										status: invite.status,
										message: "Only pending Hazel Connect invites can be accepted",
									}),
								)
							}

							yield* validateInviteAcceptanceTarget({
								invite,
								guestOrganizationId,
								findBySlug: orgRepo.findBySlug,
							})

							const hostChannelOption = yield* channelRepo.findById(invite.hostChannelId)
							if (Option.isNone(hostChannelOption)) {
								return yield* Effect.fail(
									new ChannelNotFoundError({ channelId: invite.hostChannelId }),
								)
							}
							const hostChannel = hostChannelOption.value

							const existingMount =
								yield* connectConversationChannelRepo.findByConversationAndOrganization(
									invite.conversationId,
									guestOrganizationId,
								)
							if (Option.isSome(existingMount)) {
								return yield* Effect.fail(
									new ConnectChannelAlreadySharedError({
										channelId: existingMount.value.channelId,
										organizationId: guestOrganizationId,
										message: "This workspace is already connected to the conversation",
									}),
								)
							}

							const guestChannel = yield* channelRepo
								.insert({
									name: hostChannel.name,
									icon: hostChannel.icon,
									type: hostChannel.type,
									organizationId: guestOrganizationId,
									parentChannelId: null,
									sectionId: null,
									deletedAt: null,
								})
								.pipe(Effect.map((results) => results[0]!))

							yield* channelMemberRepo.insert({
								channelId: guestChannel.id,
								userId: currentUser.id,
								isHidden: false,
								isMuted: false,
								isFavorite: false,
								lastSeenMessageId: null,
								notificationCount: 0,
								joinedAt: new Date(),
								deletedAt: null,
							})
							// A savepoint, so a unique conflict leaves the outer transaction usable for the lookup below.
							yield* db
								.transaction(
									connectConversationChannelRepo.insert({
										conversationId: invite.conversationId,
										organizationId: guestOrganizationId,
										channelId: guestChannel.id,
										role: "guest",
										allowGuestMemberAdds: invite.allowGuestMemberAdds,
										isActive: true,
										deletedAt: null,
									}),
								)
								.pipe(
									Effect.catchTag("DatabaseError", (error) =>
										remapGuestMountInsertConflict({
											error,
											guestOrganizationId,
											findExistingMount: () =>
												connectConversationChannelRepo.findByConversationAndOrganization(
													invite.conversationId,
													guestOrganizationId,
												),
										}),
									),
								)

							yield* connectInviteRepo.update({
								id: invite.id,
								status: "accepted",
								guestOrganizationId,
								acceptedBy: currentUser.id,
								acceptedAt: new Date(),
							})

							yield* connectConversationRepo.update({
								id: invite.conversationId,
								status: "active",
							})

							const hostMembers = yield* channelMemberRepo.listByChannel(hostChannel.id)

							yield* connectConversationService.addParticipantsToConversation(
								invite.conversationId,
								[
									...hostMembers.map((hostMember) => ({
										userId: hostMember.userId,
										homeOrganizationId: hostChannel.organizationId,
									})),
									{
										userId: currentUser.id,
										homeOrganizationId: guestOrganizationId,
									},
								],
								currentUser.id,
							)

							// Sync all channels in the conversation so cross-org users get access
							yield* channelAccessSync.syncConversation(invite.conversationId)

							const conversationOption = yield* connectConversationRepo.findById(
								invite.conversationId,
							)
							if (Option.isNone(conversationOption)) {
								return yield* Effect.fail(
									new ConnectConversationNotFoundError({
										conversationId: invite.conversationId,
										message: "Hazel Connect conversation disappeared during acceptance",
									}),
								)
							}
							const conversation = conversationOption.value
							const txid = yield* generateTransactionId()
							return new ConnectConversationResponse({
								data: conversation,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "create"), remapPermissionError),

			"connectShare.invite.decline": ({ inviteId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const inviteOption = yield* connectInviteRepo.findActiveById(inviteId)
							if (Option.isNone(inviteOption)) {
								return yield* Effect.fail(
									new ConnectInviteNotFoundError({
										inviteId,
										message: "Hazel Connect invite not found",
									}),
								)
							}
							if (inviteOption.value.status !== "pending") {
								return yield* Effect.fail(
									new ConnectInviteInvalidStateError({
										inviteId,
										status: inviteOption.value.status,
										message: "Only pending Hazel Connect invites can be declined",
									}),
								)
							}
							if (!inviteOption.value.guestOrganizationId) {
								return yield* Effect.fail(
									new ConnectWorkspaceNotFoundError({
										message: "This invite is not bound to a workspace",
									}),
								)
							}
							yield* requireAdminOrOwner(inviteOption.value.guestOrganizationId)
							yield* connectInviteRepo.update({
								id: inviteId,
								status: "declined",
							})
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "update"), remapPermissionError),

			"connectShare.invite.revoke": ({ inviteId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const inviteOption = yield* connectInviteRepo.findActiveById(inviteId)
							if (Option.isNone(inviteOption)) {
								return yield* Effect.fail(
									new ConnectInviteNotFoundError({
										inviteId,
										message: "Hazel Connect invite not found",
									}),
								)
							}
							const invite = inviteOption.value
							yield* requireAdminOrOwner(invite.hostOrganizationId)
							if (invite.status !== "pending") {
								return yield* Effect.fail(
									new ConnectInviteInvalidStateError({
										inviteId,
										status: invite.status,
										message: "Only pending Hazel Connect invites can be revoked",
									}),
								)
							}
							yield* connectInviteRepo.update({
								id: inviteId,
								status: "revoked",
							})
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "update"), remapPermissionError),

			"connectShare.invite.listIncoming": ({ organizationId }) =>
				Effect.gen(function* () {
					yield* orgResolver.requireScope(
						organizationId,
						"organizations:read",
						"ConnectShare",
						"listIncoming",
					)
					const invites = yield* connectInviteRepo.listIncomingForOrganization(organizationId)
					return new ConnectInviteListResponse({ data: invites })
				}).pipe(withRemapDbErrors("ConnectShare", "select"), remapPermissionError),

			"connectShare.invite.listOutgoing": ({ organizationId }) =>
				Effect.gen(function* () {
					yield* orgResolver.requireScope(
						organizationId,
						"organizations:read",
						"ConnectShare",
						"listOutgoing",
					)
					const invites = yield* connectInviteRepo.listOutgoingForOrganization(organizationId)
					return new ConnectInviteListResponse({ data: invites })
				}).pipe(withRemapDbErrors("ConnectShare", "select"), remapPermissionError),

			"connectShare.settings.update": ({ conversationId, allowGuestMemberAdds, status }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const conversationOption = yield* connectConversationRepo.findById(conversationId)
							if (Option.isNone(conversationOption)) {
								return yield* Effect.fail(
									new ConnectConversationNotFoundError({
										conversationId,
										message: "Hazel Connect conversation not found",
									}),
								)
							}
							const conversation = conversationOption.value
							yield* requireAdminOrOwner(conversation.hostOrganizationId)
							const updated = yield* connectConversationRepo.update({
								id: conversationId,
								status: status ?? conversation.status,
								settings: conversation.settings ?? null,
							})
							if (allowGuestMemberAdds !== undefined) {
								const mounts =
									yield* connectConversationChannelRepo.findByConversationId(conversationId)
								yield* Effect.forEach(
									mounts.filter((mount) => mount.role === "guest"),
									(mount) =>
										connectConversationChannelRepo.update({
											id: mount.id,
											allowGuestMemberAdds,
										}),
									{ concurrency: 10 },
								)
							}
							const txid = yield* generateTransactionId()
							return new ConnectConversationResponse({ data: updated, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "update"), remapPermissionError),

			"connectShare.member.add": ({ channelId, userId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							const channelOption = yield* channelRepo.findById(channelId)
							if (Option.isNone(channelOption)) {
								return yield* Effect.fail(new ChannelNotFoundError({ channelId: channelId }))
							}
							const channel = channelOption.value
							yield* orgResolver.fromChannel(
								channelId,
								"channel-members:write",
								"ConnectShare",
								"member.add",
							)

							const conversationId =
								yield* connectConversationService.getConversationIdForChannel(channelId)
							if (!conversationId) {
								return yield* Effect.fail(
									new ConnectConversationNotFoundError({
										message: "This channel is not shared through Hazel Connect",
									}),
								)
							}
							const mountOption =
								yield* connectConversationService.getMountForChannel(channelId)
							const mount = Option.getOrNull(mountOption)
							yield* assertGuestMemberAddsAllowed(mount)
							const userOrgMembership = yield* orgMemberRepo.findByOrgAndUser(
								channel.organizationId,
								userId,
							)
							if (Option.isNone(userOrgMembership)) {
								return yield* Effect.fail(
									new ConnectWorkspaceNotFoundError({
										message: "Only members of the current workspace can be added here",
									}),
								)
							}

							const membership = yield* channelMemberRepo.findByChannelAndUser(
								channelId,
								userId,
							)
							if (Option.isNone(membership)) {
								yield* channelMemberRepo.insert({
									channelId,
									userId,
									isHidden: false,
									isMuted: false,
									isFavorite: false,
									lastSeenMessageId: null,
									notificationCount: 0,
									joinedAt: new Date(),
									deletedAt: null,
								})
							}

							yield* connectConversationService.addParticipantToConversation(
								conversationId,
								userId,
								channel.organizationId,
								currentUser.id,
							)

							// Sync all channels so the new participant gets access across the conversation
							yield* channelAccessSync.syncConversation(conversationId)

							const participantOption = yield* connectParticipantRepo.findByChannelAndUser(
								channelId,
								userId,
							)
							if (Option.isNone(participantOption)) {
								return yield* Effect.fail(
									new InternalServerError({
										message: "Connect participant missing after upsert",
									}),
								)
							}
							const participant = participantOption.value
							const txid = yield* generateTransactionId()
							return new ConnectParticipantResponse({ data: participant, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "create"), remapPermissionError),

			"connectShare.member.remove": ({ channelId, userId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const channelOption = yield* channelRepo.findById(channelId)
							if (Option.isNone(channelOption)) {
								return yield* Effect.fail(new ChannelNotFoundError({ channelId: channelId }))
							}
							const channel = channelOption.value
							yield* orgResolver.fromChannel(
								channelId,
								"channel-members:write",
								"ConnectShare",
								"member.remove",
							)
							const userOrgMembership = yield* orgMemberRepo.findByOrgAndUser(
								channel.organizationId,
								userId,
							)
							if (Option.isNone(userOrgMembership)) {
								return yield* Effect.fail(
									new ConnectWorkspaceNotFoundError({
										message: "Only members of the current workspace can be removed here",
									}),
								)
							}
							const conversationId =
								yield* connectConversationService.getConversationIdForChannel(channelId)
							const membership = yield* channelMemberRepo.findByChannelAndUser(
								channelId,
								userId,
							)
							if (Option.isSome(membership)) {
								yield* channelMemberRepo.deleteById(membership.value.id)
							}
							if (conversationId) {
								yield* connectConversationService.removeParticipantFromConversation(
									conversationId,
									userId,
								)
							} else {
								yield* channelAccessSync.syncChannel(channelId)
							}
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "delete"), remapPermissionError),

			"connectShare.organization.disconnect": ({ conversationId, organizationId }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const conversationOption = yield* connectConversationRepo.findById(conversationId)
							if (Option.isNone(conversationOption)) {
								return yield* Effect.fail(
									new ConnectConversationNotFoundError({
										conversationId,
										message: "Hazel Connect conversation not found",
									}),
								)
							}
							yield* requireDisconnectAuthority(
								conversationOption.value.hostOrganizationId,
								organizationId,
							)
							yield* connectConversationService.disconnectOrganization(
								conversationId,
								organizationId,
							)
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(withRemapDbErrors("ConnectShare", "delete"), remapPermissionError),
		}
	}),
)
