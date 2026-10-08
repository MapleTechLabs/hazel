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

const PENDING_PAGE_SIZE = 10
/** A wider page for the revoke lookup, so a row pushed past the first 10 is still found. */
const MAX_PAGE_SIZE = 100

/** The active Clerk organization, if it exposes invitations. */
const activeOrganization = (): InvitationsOrganization | null => {
	const clerk: unknown = window.Clerk
	const organization: unknown =
		typeof clerk === "object" && clerk !== null && "organization" in clerk ? clerk.organization : null
	return hasInvitations(organization) ? organization : null
}

const pendingPage = (organization: InvitationsOrganization, pageSize: number) =>
	Effect.tryPromise(() => organization.getInvitations({ initialPage: 1, pageSize, status: ["pending"] }))

/** The first page of pending invitations (the hook's infinite mode, which legacy never advances). */
export const fetchPendingInvitations: Effect.Effect<ReadonlyArray<Invitation>> = Effect.suspend(() => {
	const organization = activeOrganization()
	if (organization === null) return Effect.succeed([])
	return pendingPage(organization, PENDING_PAGE_SIZE).pipe(
		Effect.map((response) =>
			response.data.map((invitation) => ({
				id: invitation.id,
				emailAddress: invitation.emailAddress,
				role: invitation.role,
				createdAtMs:
					typeof invitation.createdAt === "number"
						? invitation.createdAt
						: invitation.createdAt.getTime(),
			})),
		),
		// SWR keeps the error to itself; the page shows the empty state.
		Effect.orElseSucceed(() => []),
	)
})

export class RevokeInvitationError extends Schema.TaggedError<RevokeInvitationError>()(
	"RevokeInvitationError",
	{ message: Schema.String, cause: Schema.Defect() },
) {}

/** Looks the Clerk invitation up again (no handle kept between Commands), then calls its `revoke`. */
export const revokeInvitation = (id: string): Effect.Effect<void, RevokeInvitationError> =>
	Effect.suspend(() => {
		const organization = activeOrganization()
		if (organization === null) {
			return Effect.fail(new RevokeInvitationError({ message: "No active organization", cause: null }))
		}
		return pendingPage(organization, MAX_PAGE_SIZE).pipe(
			Effect.mapError((cause) => new RevokeInvitationError({ message: "Lookup failed", cause })),
			Effect.flatMap((response) => {
				const invitation = response.data.find((candidate) => candidate.id === id)
				return invitation === undefined
					? Effect.fail(
							new RevokeInvitationError({ message: `Unknown invitation ${id}`, cause: null }),
						)
					: Effect.tryPromise({
							try: () => invitation.revoke(),
							catch: (cause) => new RevokeInvitationError({ message: "Revoke failed", cause }),
						})
			}),
			Effect.asVoid,
		)
	})
