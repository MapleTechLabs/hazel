import {
	ChannelMemberRepo,
	ChannelRepo,
	InvitationRepo,
	OrganizationMemberRepo,
	OrganizationRepo,
} from "@hazel/backend-core"
import { Database, type SQLite, type schema } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import {
	Invitation,
	InvitationAccepted,
	InvitationCreateResult,
	InvitationEmailMismatchError,
	InvitationNotFoundError,
	InvitationPreview,
	type InvitationRole,
	type InvitationSkip,
	InvitationUnavailableError,
	OrganizationNotFoundError,
} from "@hazel/domain/rpc"
import type { InvitationId, OrganizationId } from "@hazel/schema"
import { Config, Context, DateTime, Effect, Layer, Option } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { InvitationPolicy } from "../policies/invitation-policy"
import { ChannelAccessSyncService } from "./channel-access-sync"
import { InviteMailer } from "./invite-mailer"

/** How long an invite link works. */
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

type InvitationRow = SQLite.SelectRowOf<typeof schema.organizationInvitationsTable>

const newToken = () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))

/** Only the hash is stored, so a database read can't produce working links. */
const hashToken = (token: string) =>
	Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).pipe(
		Effect.map((digest) => Hex.encode(new Uint8Array(digest))),
	)

const toInvitation = (row: InvitationRow) =>
	new Invitation({
		id: row.id,
		organizationId: row.organizationId,
		email: row.email,
		role: row.role === "admin" ? "admin" : "member",
		invitedBy: row.invitedBy,
		createdAt: DateTime.fromDateUnsafe(row.createdAt),
		expiresAt: DateTime.fromDateUnsafe(row.expiresAt),
	})

const statusOf = (row: InvitationRow, now: Date) =>
	row.status === "accepted"
		? ("Accepted" as const)
		: row.status === "revoked"
			? ("Revoked" as const)
			: row.expiresAt <= now
				? ("Expired" as const)
				: ("Pending" as const)

/**
 * Organization email invitations: invite by email, list and revoke (admins and owners), and the
 * public link's preview and accept. The `invitation.*` RPCs delegate here.
 */
export class Invitations extends Context.Service<Invitations>()("Invitations", {
	make: Effect.gen(function* () {
		const db = yield* Database.Database
		const policy = yield* InvitationPolicy
		const invitationRepo = yield* InvitationRepo
		const organizationRepo = yield* OrganizationRepo
		const organizationMemberRepo = yield* OrganizationMemberRepo
		const channelRepo = yield* ChannelRepo
		const channelMemberRepo = yield* ChannelMemberRepo
		const channelAccessSync = yield* ChannelAccessSyncService
		const mailer = yield* InviteMailer
		const frontendUrl = yield* Config.String("FRONTEND_URL")

		const findByToken = (token: string) =>
			hashToken(token).pipe(
				Effect.flatMap(invitationRepo.findByTokenHash),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.fail(new InvitationNotFoundError()),
						onSome: Effect.succeed,
					}),
				),
			)

		const findOrganization = (organizationId: InvitationRow["organizationId"]) =>
			organizationRepo
				.findById(organizationId)
				.pipe(
					Effect.flatMap((organization) =>
						Option.isSome(organization) && organization.value.deletedAt === null
							? Effect.succeed(organization.value)
							: Effect.fail(new OrganizationNotFoundError({ organizationId })),
					),
				)

		return {
			create: ({
				organizationId,
				emails,
				role,
			}: {
				readonly organizationId: OrganizationId
				readonly emails: ReadonlyArray<string>
				readonly role: InvitationRole
			}) =>
				Effect.gen(function* () {
					yield* policy.canManage(organizationId, "create")
					const currentUser = yield* CurrentUser.Context
					const organization = yield* findOrganization(organizationId)
					const inviterName =
						`${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email

					const addresses = [...new Set(emails.map((email) => email.toLowerCase()))]
					const members = yield* invitationRepo.findMemberEmails(organizationId, addresses)

					const invited: Array<Invitation> = []
					const skipped: Array<InvitationSkip> = addresses
						.filter((email) => members.has(email))
						.map((email) => ({ email, reason: "AlreadyMember" as const }))

					for (const email of addresses.filter((address) => !members.has(address))) {
						const token = newToken()
						const row = yield* invitationRepo.upsertPending({
							organizationId,
							email,
							role,
							tokenHash: yield* hashToken(token),
							invitedBy: currentUser.id,
							expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
						})
						const sent = yield* mailer
							.send({
								to: email,
								organizationName: organization.name,
								inviterName,
								acceptUrl: new URL(`/invite/${token}`, frontendUrl).href,
							})
							.pipe(Effect.result)
						if (sent._tag === "Success") {
							invited.push(toInvitation(row))
						} else {
							// A link nobody received shouldn't sit in the pending list.
							yield* Effect.logWarning("[invite] email failed", { error: sent.failure.message })
							yield* invitationRepo.revoke(row.id, row.tokenHash)
							skipped.push({ email, reason: "EmailFailed" })
						}
					}

					return new InvitationCreateResult({ invited, skipped })
				}).pipe(withRemapDbErrors("Invitation", "create")),

			list: ({ organizationId }: { readonly organizationId: OrganizationId }) =>
				Effect.gen(function* () {
					yield* policy.canManage(organizationId, "select")
					const rows = yield* invitationRepo.listPending(organizationId, new Date())
					return rows.map(toInvitation)
				}).pipe(withRemapDbErrors("Invitation", "select")),

			revoke: ({ id }: { readonly id: InvitationId }) =>
				Effect.gen(function* () {
					const invitation = yield* invitationRepo.findById(id)
					if (Option.isNone(invitation)) return yield* new InvitationNotFoundError()
					yield* policy.canManage(invitation.value.organizationId, "delete")
					yield* invitationRepo.revoke(id)
				}).pipe(withRemapDbErrors("Invitation", "delete")),

			preview: ({ token }: { readonly token: string }) =>
				Effect.gen(function* () {
					const invitation = yield* findByToken(token)
					const organization = yield* findOrganization(invitation.organizationId).pipe(
						Effect.catchTag("OrganizationNotFoundError", () =>
							Effect.fail(new InvitationNotFoundError()),
						),
					)
					return new InvitationPreview({
						organizationName: organization.name,
						organizationLogoUrl: organization.logoUrl ?? null,
						email: invitation.email,
						status: statusOf(invitation, new Date()),
					})
				}).pipe(withRemapDbErrors("Invitation", "select")),

			accept: ({ token }: { readonly token: string }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const currentUser = yield* CurrentUser.Context
							const invitation = yield* findByToken(token)
							const status = statusOf(invitation, new Date())
							if (status !== "Pending") return yield* new InvitationUnavailableError({ status })
							if (currentUser.email.toLowerCase() !== invitation.email)
								return yield* new InvitationEmailMismatchError({
									invitedEmail: invitation.email,
								})

							const organization = yield* findOrganization(invitation.organizationId)
							const accepted = yield* invitationRepo.markAccepted(
								invitation.id,
								currentUser.id,
								invitation.tokenHash,
							)
							if (Option.isNone(accepted))
								return yield* new InvitationUnavailableError({ status: "Accepted" })

							const existing = yield* organizationMemberRepo.findByOrgAndUser(
								organization.id,
								currentUser.id,
							)
							if (Option.isNone(existing) || existing.value.deletedAt !== null) {
								yield* organizationMemberRepo.upsertByOrgAndUser({
									organizationId: organization.id,
									userId: currentUser.id,
									role: invitation.role,
									nickname: undefined,
									joinedAt: new Date(),
									invitedBy: invitation.invitedBy,
									deletedAt: null,
								})
								// Like joining by public link: into #general.
								const general = yield* channelRepo.findByOrgAndName(
									organization.id,
									"general",
								)
								if (Option.isSome(general)) {
									const membership = yield* channelMemberRepo.findByChannelAndUser(
										general.value.id,
										currentUser.id,
									)
									if (Option.isNone(membership))
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
								yield* channelAccessSync.syncUserInOrganization(
									currentUser.id,
									organization.id,
								)
							}

							return new InvitationAccepted({
								organizationId: organization.id,
								slug: organization.slug ?? null,
							})
						}),
					)
					.pipe(withRemapDbErrors("Invitation", "update")),
		}
	}),
}) {
	/** Needs `Database`, `InviteMailer` and `FRONTEND_URL` from the platform. */
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(InvitationPolicy.layer),
		Layer.provide(ChannelAccessSyncService.layer),
		Layer.provide(InvitationRepo.layer),
		Layer.provide(OrganizationRepo.layer),
		Layer.provide(OrganizationMemberRepo.layer),
		Layer.provide(ChannelRepo.layer),
		Layer.provide(ChannelMemberRepo.layer),
	)
}
