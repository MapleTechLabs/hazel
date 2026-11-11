import type { OrganizationId } from "@hazel/schema"
import { Match, Option } from "effect"
import { AppRoute, isPublicRoute, organizationRoute } from "./route"
import type { Auth, CurrentUser } from "./session"

/** The redirects legacy does in `beforeLoad` and `<Navigate>`, as pure functions of the route. */

/**
 * Index routes that only forward somewhere else, whatever the session. Redirect-only routes with
 * a page (`ChannelSettings`) forward from the page's `init` instead.
 */
export const routeRedirect = (
	route: AppRoute,
	options: { readonly isProd: boolean },
): Option.Option<AppRoute> =>
	Match.value(route).pipe(
		// `settings/debug.tsx` is dev-only.
		Match.tag("SettingsDebug", ({ orgSlug }) =>
			options.isProd ? Option.some(AppRoute.SettingsGeneral({ orgSlug })) : Option.none<AppRoute>(),
		),
		Match.orElse(() => Option.none<AppRoute>()),
	)

/** `_app/layout.tsx` `Gate`: a signed-out visitor on an app route goes to sign-in, then back. */
export const authRedirect = (route: AppRoute, auth: Auth, currentUrl: string): Option.Option<AppRoute> =>
	auth === "SignedOut" && !isPublicRoute(route)
		? Option.some(AppRoute.SignIn({ redirectUrl: Option.some(currentUrl) }))
		: Option.none()

export interface RootMembership {
	readonly organizationId: OrganizationId
	readonly slug: string | null
}

/** `_app/index.tsx`: where `/` sends a signed-in user once their membership is known. */
export const rootRedirect = (user: CurrentUser, membership: Option.Option<RootMembership>): AppRoute => {
	if (!user.isOnboarded)
		return AppRoute.Onboarding({
			orgId: Option.map(membership, ({ organizationId }) => organizationId),
			step: Option.none(),
		})
	return Option.match(membership, {
		onNone: () => AppRoute.SelectOrganization(),
		onSome: ({ organizationId, slug }) => organizationRoute({ id: organizationId, slug }),
	})
}
