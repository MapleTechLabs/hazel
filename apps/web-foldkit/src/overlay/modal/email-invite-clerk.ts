import { Effect, Exit, Option } from "effect"

/**
 * Clerk's `useOrganization().organization.inviteMember`, read from `window.Clerk` (the instance the
 * legacy app uses). `window.Clerk` is typed as a constructor union, so the shape is narrowed here.
 */

export type InviteRole = "org:member" | "org:admin"

export interface Invite {
	readonly email: string
	readonly role: InviteRole
}

interface InvitingOrganization {
	readonly inviteMember: (params: { emailAddress: string; role: string }) => Promise<unknown>
}

const isInvitingOrganization = (value: unknown): value is InvitingOrganization =>
	typeof value === "object" && value !== null && "inviteMember" in value && typeof value.inviteMember === "function"

const activeOrganization = (): Option.Option<InvitingOrganization> => {
	const clerk: unknown = window.Clerk
	return typeof clerk === "object" && clerk !== null && "organization" in clerk && isInvitingOrganization(clerk.organization)
		? Option.some(clerk.organization)
		: Option.none()
}

export interface InviteResults {
	readonly successCount: number
	readonly errorCount: number
}

/** `Promise.allSettled` over the invites; None without an active organization. */
export const sendInvites = (invites: ReadonlyArray<Invite>): Effect.Effect<Option.Option<InviteResults>> =>
	Effect.suspend(() =>
		Option.match(activeOrganization(), {
			onNone: () => Effect.succeed(Option.none<InviteResults>()),
			onSome: (organization) =>
				Effect.forEach(
					invites,
					(invite) =>
						Effect.tryPromise(() =>
							organization.inviteMember({ emailAddress: invite.email.trim(), role: invite.role }),
						).pipe(
							Effect.tapError((error) => Effect.logError(`Failed to invite ${invite.email}`, error)),
							Effect.exit,
						),
					{ concurrency: "unbounded" },
				).pipe(
					Effect.map((exits) => {
						const successCount = exits.filter(Exit.isSuccess).length
						return Option.some({ successCount, errorCount: exits.length - successCount })
					}),
				),
		}),
	)
