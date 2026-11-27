/**
 * The session a page reads as a prop: who is signed in, the route's organization and the user's
 * row in it, as the app's root holds them (`web-foldkit/src/root/state.ts`). A page never copies
 * it into its Model.
 */
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"

export const SessionUser = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	isOnboarded: Schema.Boolean,
})
export type SessionUser = typeof SessionUser.Type

export const SessionOrganization = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type SessionOrganization = typeof SessionOrganization.Type

export const SessionMember = Schema.Struct({
	id: OrganizationMemberId,
	role: Schema.Literals(["owner", "admin", "member"]),
})
export type SessionMember = typeof SessionMember.Type

export const Session = Schema.Struct({
	/** Whether the API has a session for this browser; `Loading` until it answers. */
	auth: Schema.Literals(["Loading", "SignedIn", "SignedOut"]),
	/** `user.me`, once it answered. */
	user: Schema.NullOr(SessionUser),
	/** The route's organization once loaded, never another slug's, and the user's row in it. */
	organization: Schema.NullOr(SessionOrganization),
	member: Schema.NullOr(SessionMember),
	/** The route's organization slug, before the organization has loaded. */
	orgSlug: Schema.NullOr(Schema.String),
})
export type Session = typeof Session.Type

/** Nothing is known about the user yet: the session check or `user.me` has not answered. */
export const isSessionLoading = (session: Session): boolean =>
	session.auth === "Loading" || (session.auth === "SignedIn" && session.user === null)
