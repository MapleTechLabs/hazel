import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"

/** App-wide session state the root owns and every page may read (see `page/README.md`). */

export const CurrentUser = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	isOnboarded: Schema.Boolean,
	/** The organization in the Clerk JWT, if any (legacy `useAuth().user.organizationId`). */
	organizationId: Schema.NullOr(OrganizationId),
})
export type CurrentUser = typeof CurrentUser.Type

export const Organization = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type Organization = typeof Organization.Type

/** The signed-in user's membership in the route's organization (legacy `usePermission`). */
export const Member = Schema.Struct({
	id: OrganizationMemberId,
	role: Schema.Literals(["owner", "admin", "member"]),
})
export type Member = typeof Member.Type

/** Clerk session state, read from `window.Clerk` (`treatPendingAsSignedOut: false`). */
export const Auth = Schema.Literals(["Loading", "SignedIn", "SignedOut"])
export type Auth = typeof Auth.Type

export const displayNameOf = (user: CurrentUser) =>
	user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email || "User"
