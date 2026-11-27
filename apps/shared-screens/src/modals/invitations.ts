/**
 * Organization email invitations (`invitation.create`, as `web-foldkit/src/data/invitations.ts`): one
 * call per role; an address the schema refuses or the server skips counts as a failure.
 */
import { HazelRpc } from "@hazel/client-data"
import { InvitationEmail, type InvitationRole } from "@hazel/domain/rpc"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"

export interface Invite {
	readonly email: string
	readonly role: InvitationRole
}

export interface InviteResults {
	readonly successCount: number
	readonly errorCount: number
}

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
