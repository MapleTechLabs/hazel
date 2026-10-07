import { Effect, Schema } from "effect"

/** Clerk organization invitations (legacy `useOrganization({ invitations })`), read via `window.Clerk`. */

export interface Invitation {
	readonly id: string
	readonly emailAddress: string
	readonly role: string
	readonly createdAtMs: number
}

interface ClerkInvitation {
	readonly id: string
	readonly emailAddress: string
	readonly role: string
	readonly createdAt: Date | number
	readonly revoke: () => Promise<unknown>
}
interface InvitationsOrganization {
	readonly getInvitations: (params: {
		initialPage: number
		pageSize: number
		status: ReadonlyArray<string>
	}) => Promise<{ readonly data: ReadonlyArray<ClerkInvitation> }>
}

const hasInvitations = (organization: unknown): organization is InvitationsOrganization =>
	typeof organization === "object" &&
	organization !== null &&
	"getInvitations" in organization &&
	typeof organization.getInvitations === "function"

/** The Clerk resources by id, so a revoke calls the same resource method legacy calls. */
const resources = new Map<string, ClerkInvitation>()

/** The first page of pending invitations (the hook's infinite mode, which legacy never advances). */
export const fetchPendingInvitations: Effect.Effect<ReadonlyArray<Invitation>> = Effect.suspend(() => {
	const clerk: unknown = window.Clerk
	const organization: unknown =
		typeof clerk === "object" && clerk !== null && "organization" in clerk ? clerk.organization : null
	if (!hasInvitations(organization)) return Effect.succeed([])
	return Effect.tryPromise(() =>
		organization.getInvitations({ initialPage: 1, pageSize: 10, status: ["pending"] }),
	).pipe(
		Effect.map((response) => {
			resources.clear()
			return response.data.map((invitation) => {
				resources.set(invitation.id, invitation)
				return {
					id: invitation.id,
					emailAddress: invitation.emailAddress,
					role: invitation.role,
					createdAtMs:
						typeof invitation.createdAt === "number"
							? invitation.createdAt
							: invitation.createdAt.getTime(),
				}
			})
		}),
		// SWR keeps the error to itself; the page shows the empty state.
		Effect.orElseSucceed(() => []),
	)
})

export class RevokeInvitationError extends Schema.TaggedError<RevokeInvitationError>()(
	"RevokeInvitationError",
	{ message: Schema.String, cause: Schema.Defect() },
) {}

export const revokeInvitation = (id: string): Effect.Effect<void, RevokeInvitationError> =>
	Effect.suspend(() => {
		const invitation = resources.get(id)
		return invitation === undefined
			? Effect.fail(new RevokeInvitationError({ message: `Unknown invitation ${id}`, cause: null }))
			: Effect.tryPromise({
					try: () => invitation.revoke(),
					catch: (cause) => new RevokeInvitationError({ message: "Revoke failed", cause }),
				}).pipe(Effect.asVoid)
	})
