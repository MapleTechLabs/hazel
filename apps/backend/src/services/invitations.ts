import { InvitationRepo, OrganizationRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, InternalServerError, withRemapDbErrors } from "@hazel/domain"
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
import { DirectoryWireOrgEffects } from "../worker/objects/directory-wire"
import { applyNow } from "../worker/objects/fanout"
import { orgTarget } from "../worker/objects/kinds"
import { toUserProjection } from "../worker/objects/org/projections"
import { Directory } from "./directory"
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
 * Organization email invitations. The rows (and token lookup) are the directory's (D1,
 * `organization_invitations`); no transactions, each write one statement.
 *
 * - `create`, `list`, `revoke` run in the org's `OrgObject` (`rpc/routing.ts`): the admin check and
 *   the member emails are the org's, the invitation rows are written to D1 directly.
 * - `preview` and `accept` run on the directory path. Accepting applies `org.acceptInvitation`
 *   at the org right away (keyed by the invitation, so a retry is applied once), then marks the
 *   invitation accepted.
 */
export class Invitations extends Context.Service<Invitations>()("Invitations", {
	make: Effect.gen(function* () {
		const policy = yield* InvitationPolicy
		/** Over the store the call runs in: the org's members and users in an `OrgObject`. */
		const localInvitations = yield* InvitationRepo
		const organizationRepo = yield* OrganizationRepo
		const mailer = yield* InviteMailer
		const frontendUrl = yield* Config.String("FRONTEND_URL")

		/** The invitation rows, over D1. */
		const invitationRepo = Effect.flatMap(Directory, (directory) =>
			InvitationRepo.make.pipe(Effect.provideService(Database.Database, directory.db)),
		)

		const findByToken = (token: string) =>
			Effect.gen(function* () {
				const repo = yield* invitationRepo
				const row = yield* repo.findByTokenHash(yield* hashToken(token))
				return yield* Option.match(row, {
					onNone: () => Effect.fail(new InvitationNotFoundError()),
					onSome: Effect.succeed,
				})
			})

		/** The org's directory index row (name, slug), if it is live. */
		const findIndexedOrganization = (organizationId: OrganizationId) =>
			Effect.flatMap(Directory, (directory) => directory.org(organizationId)).pipe(
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
					const organization = yield* organizationRepo
						.findById(organizationId)
						.pipe(
							Effect.flatMap((row) =>
								Option.isSome(row) && row.value.deletedAt === null
									? Effect.succeed(row.value)
									: Effect.fail(new OrganizationNotFoundError({ organizationId })),
							),
						)
					const repo = yield* invitationRepo
					const inviterName =
						`${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email

					const addresses = [...new Set(emails.map((email) => email.toLowerCase()))]
					const members = yield* localInvitations.findMemberEmails(organizationId, addresses)

					const invited: Array<Invitation> = []
					const skipped: Array<InvitationSkip> = addresses
						.filter((email) => members.has(email))
						.map((email) => ({ email, reason: "AlreadyMember" as const }))

					for (const email of addresses.filter((address) => !members.has(address))) {
						const token = newToken()
						const row = yield* repo.upsertPending({
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
							yield* repo.revoke(row.id, row.tokenHash)
							skipped.push({ email, reason: "EmailFailed" })
						}
					}

					return new InvitationCreateResult({ invited, skipped })
				}).pipe(withRemapDbErrors("Invitation", "create"), Effect.withSpan("Invitations.create")),

			list: ({ organizationId }: { readonly organizationId: OrganizationId }) =>
				Effect.gen(function* () {
					yield* policy.canManage(organizationId, "select")
					const repo = yield* invitationRepo
					const rows = yield* repo.listPending(organizationId, new Date())
					return rows.map(toInvitation)
				}).pipe(withRemapDbErrors("Invitation", "select")),

			revoke: ({ id }: { readonly id: InvitationId }) =>
				Effect.gen(function* () {
					const repo = yield* invitationRepo
					const invitation = yield* repo.findById(id)
					if (Option.isNone(invitation)) return yield* new InvitationNotFoundError()
					yield* policy.canManage(invitation.value.organizationId, "delete")
					yield* repo.revoke(id)
				}).pipe(withRemapDbErrors("Invitation", "delete")),

			preview: ({ token }: { readonly token: string }) =>
				Effect.gen(function* () {
					const invitation = yield* findByToken(token)
					const organization = yield* findIndexedOrganization(invitation.organizationId).pipe(
						Effect.catchTag("OrganizationNotFoundError", () =>
							Effect.fail(new InvitationNotFoundError()),
						),
					)
					return new InvitationPreview({
						organizationName: organization.name,
						// The directory's org index carries no logo.
						organizationLogoUrl: null,
						email: invitation.email,
						status: statusOf(invitation, new Date()),
					})
				}).pipe(withRemapDbErrors("Invitation", "select")),

			accept: ({ token }: { readonly token: string }) =>
				Effect.gen(function* () {
					const currentUser = yield* CurrentUser.Context
					const directory = yield* Directory
					const invitation = yield* findByToken(token)
					const status = statusOf(invitation, new Date())
					if (status !== "Pending") return yield* new InvitationUnavailableError({ status })
					if (currentUser.email.toLowerCase() !== invitation.email)
						return yield* new InvitationEmailMismatchError({ invitedEmail: invitation.email })
					const organization = yield* findIndexedOrganization(invitation.organizationId)

					const user = yield* directory.db.first(
						SQLite.from(schema.usersTable)
							.select()
							.where(($) => [$.id.eq(currentUser.id)])
							.limit(1),
					)
					if (Option.isNone(user)) return yield* new InvitationNotFoundError()

					// Join first: a failure leaves the invitation pending for a retry.
					yield* applyNow(
						DirectoryWireOrgEffects.acceptInvitation,
						orgTarget(organization.id),
						{
							invitationId: invitation.id,
							organizationId: organization.id,
							role: invitation.role === "admin" ? "admin" : "member",
							invitedBy: invitation.invitedBy,
							user: toUserProjection(user.value),
						},
						`invitation:${invitation.id}`,
					).pipe(
						Effect.catchTags({
							ApplyNowError: (error) =>
								Effect.fail(
									new InternalServerError({
										message: "Could not join the organization",
										cause: error,
									}),
								),
							SchemaError: (error) =>
								Effect.fail(
									new InternalServerError({
										message: "Could not join the organization",
										cause: error,
									}),
								),
						}),
					)

					const repo = yield* invitationRepo
					const accepted = yield* repo.markAccepted(
						invitation.id,
						currentUser.id,
						invitation.tokenHash,
					)
					if (Option.isNone(accepted))
						return yield* new InvitationUnavailableError({ status: "Accepted" })

					return new InvitationAccepted({
						organizationId: organization.id,
						slug: organization.slug ?? null,
					})
				}).pipe(withRemapDbErrors("Invitation", "update"), Effect.withSpan("Invitations.accept")),
		}
	}),
}) {
	/** Needs `Database`, `Directory`, `ObjectStubs`, `InviteMailer` and `FRONTEND_URL` from the host. */
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(InvitationPolicy.layer),
		Layer.provide(InvitationRepo.layer),
		Layer.provide(OrganizationRepo.layer),
	)
}
