import { InvitationEmail, type InvitationRole } from "@hazel/domain/rpc"
import type { InvitationId, OrganizationId } from "@hazel/schema"
import { DateTime, Effect, Schema } from "effect"
import { HazelRpc } from "../rpc"

/** Organization email invitations (`invitation.*`), shared by settings, onboarding and the invite modal. */

export interface Invite {
	readonly email: string
	readonly role: InvitationRole
}

export interface InviteResults {
	readonly successCount: number
	readonly errorCount: number
}

/** Sends the invites, one `invitation.create` per role; skipped addresses count as failures. */
export const sendInvitations = (organizationId: OrganizationId, invites: ReadonlyArray<Invite>) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const roles = [...new Set(invites.map((invite) => invite.role))]
		const results = yield* Effect.forEach(
			roles,
			(role) => {
				const candidates = invites
					.filter((invite) => invite.role === role)
					.map((invite) => invite.email.trim())
				const emails = candidates.filter(Schema.is(InvitationEmail))
				const invalidCount = candidates.length - emails.length
				if (emails.length === 0) return Effect.succeed({ successCount: 0, errorCount: invalidCount })
				return client("invitation.create", { organizationId, emails, role }).pipe(
					Effect.map((result) => ({
						successCount: result.invited.length,
						errorCount: result.skipped.length + invalidCount,
					})),
					Effect.tapError((error) => Effect.logError("Failed to send invitations", error)),
					Effect.orElseSucceed(() => ({ successCount: 0, errorCount: candidates.length })),
				)
			},
			{ concurrency: "unbounded" },
		)
		return results.reduce<InviteResults>(
			(total, result) => ({
				successCount: total.successCount + result.successCount,
				errorCount: total.errorCount + result.errorCount,
			}),
			{ successCount: 0, errorCount: 0 },
		)
	})

export interface PendingInvitation {
	readonly id: InvitationId
	readonly emailAddress: string
	readonly role: InvitationRole
	readonly createdAtMs: number
}

export const listInvitations = (organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const invitations = yield* client("invitation.list", { organizationId })
		return invitations.map((invitation): PendingInvitation => ({
			id: invitation.id,
			emailAddress: invitation.email,
			role: invitation.role,
			createdAtMs: DateTime.toEpochMillis(invitation.createdAt),
		}))
	})

export const revokeInvitation = (id: InvitationId) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		yield* client("invitation.revoke", { id })
	})
