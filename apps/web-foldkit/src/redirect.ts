import type { OrganizationId } from "@hazel/schema"
import { Match, Option } from "effect"
import { AppRoute, hrefOf, isPublicRoute, organizationHref, signInHref } from "./route"
import type { Auth, CurrentUser } from "./session"

/** The redirects legacy does in `beforeLoad` and `<Navigate>`, as pure functions of the route. */

/**
 * Index routes that only forward somewhere else, whatever the session. Redirect-only routes with
 * a page (`ChannelSettings`) forward from the page's `init` instead.
 */
export const routeRedirect = (
	route: AppRoute,
	options: { readonly isProd: boolean },
): Option.Option<string> =>
	Match.value(route).pipe(
		// `settings/debug.tsx` is dev-only.
		Match.tag("SettingsDebug", ({ orgSlug }) =>
			options.isProd
				? Option.some(hrefOf(AppRoute.SettingsGeneral({ orgSlug })))
				: Option.none<string>(),
		),
		Match.orElse(() => Option.none<string>()),
	)

/** `_app/layout.tsx` `Gate`: a signed-out visitor on an app route goes to sign-in, then back. */
export const authRedirect = (route: AppRoute, auth: Auth, currentUrl: string): Option.Option<string> =>
	auth === "SignedOut" && !isPublicRoute(route) ? Option.some(signInHref(currentUrl)) : Option.none()

export interface RootMembership {
	readonly organizationId: OrganizationId
	readonly slug: string | null
}

/** `_app/index.tsx`: where `/` sends a signed-in user once their membership is known. */
export const rootRedirect = (user: CurrentUser, membership: Option.Option<RootMembership>): string => {
	if (!user.isOnboarded)
		return hrefOf(
			AppRoute.Onboarding({
				orgId: Option.map(membership, ({ organizationId }) => organizationId),
				step: Option.none(),
			}),
		)
	return Option.match(membership, {
		onNone: () => hrefOf(AppRoute.SelectOrganization()),
		onSome: ({ organizationId, slug }) => organizationHref({ id: organizationId, slug }),
	})
}
