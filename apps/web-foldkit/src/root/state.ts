/**
 * The shell's session and organization state, moved from the Foldkit root unchanged. The Schemas
 * still build on Foldkit's `AsyncData` and tagged unions (plain Effect Schemas); they go with Foldkit.
 */
import { Option, Schema } from "effect"
import { AsyncData } from "foldkit"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import { type AppRoute, orgSlugOf } from "../route"
import { type Auth, CurrentUser, Member, Organization } from "../session"

/** `user.me` for the signed-in session; a failure keeps its reason for the error screen. */
export const CurrentUserData = AsyncData.Schema(CurrentUser, CommonReason)
export type CurrentUserData = typeof CurrentUserData.schema.Type

/**
 * Whether the API has a session for this browser. `Unreachable` is not signed out: the API did not
 * answer, so nothing is known about the session and the app offers to try again.
 */
export const Session = defineTaggedUnion({
	/** `isFetchingUser`: the boot `user.me` runs beside the session check, so a confirmed session need not ask again. */
	Loading: { isFetchingUser: Schema.Boolean },
	Unreachable: { reason: CommonReason, retries: Schema.Finite },
	SignedOut: {},
	/** `retries`: automatic `user.me` retries so far; past the limit the error screen offers one by hand. */
	SignedIn: { user: CurrentUserData.schema, retries: Schema.Finite },
})
export type Session = typeof Session.Type

/** The user's row in the loaded organization (`usePermission`); `null` when they have none. */
export const MemberData = AsyncData.Schema(Schema.NullOr(Member), Schema.Never)
export type MemberData = typeof MemberData.schema.Type

/**
 * The organization the route names (`useOrganization()`), keyed by its slug: a switch to another
 * slug starts over at `Loading`, so the previous organization and role never show under the new one.
 */
export const OrgState = defineTaggedUnion({
	/** The route names no organization. */
	None: {},
	/** `isStalled`: not loaded after a while; the loader offers a reload. */
	Loading: { slug: Schema.String, isStalled: Schema.Boolean },
	/** No such organization, or the user is not a member. */
	NotFound: { slug: Schema.String },
	Loaded: { slug: Schema.String, organization: Organization, member: MemberData.schema },
})
export type OrgState = typeof OrgState.Type

/** The org state a route starts with: kept while the slug stays, `Loading` for a new one. */
export const orgStateFor = (current: OrgState, route: AppRoute): OrgState => {
	const slug = orgSlugOf(route)
	if (slug === undefined) return OrgState.None()
	return current._tag !== "None" && current.slug === slug
		? current
		: OrgState.Loading({ slug, isStalled: false })
}

export const authOf = (session: Session): Auth =>
	Session.match(session, {
		Loading: (): Auth => "Loading",
		Unreachable: (): Auth => "Loading",
		SignedOut: (): Auth => "SignedOut",
		SignedIn: (): Auth => "SignedIn",
	})

export const currentUserOfSession = (session: Session): CurrentUser | null =>
	session._tag === "SignedIn" ? Option.getOrNull(AsyncData.getData(session.user)) : null

/** The organization the route names, once loaded; never another slug's. */
export const loadedOrgOf = (
	org: OrgState,
	route: AppRoute,
): Option.Option<Extract<OrgState, { _tag: "Loaded" }>> =>
	org._tag === "Loaded" && org.slug === orgSlugOf(route) ? Option.some(org) : Option.none()

export const memberOfOrg = (org: OrgState, route: AppRoute): Member | null =>
	Option.getOrNull(
		Option.flatMap(loadedOrgOf(org, route), (loaded) =>
			Option.flatMapNullishOr(AsyncData.getData(loaded.member), (member) => member),
		),
	)
