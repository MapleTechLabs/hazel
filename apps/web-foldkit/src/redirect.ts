import { Match, Option } from "effect"
import { type AppRoute, isPublicRoute } from "./route"
import type { Auth, CurrentUser } from "./session"

/** The redirects legacy does in `beforeLoad` and `<Navigate>`, as pure functions of the route. */

/** Index routes that only forward somewhere else, whatever the session. */
export const routeRedirect = (
	route: AppRoute,
	options: { readonly isProd: boolean },
): Option.Option<string> =>
	Match.value(route).pipe(
		Match.tag("ChannelSettings", ({ orgSlug, channelId }) =>
			Option.some(`/${orgSlug}/channels/${channelId}/settings/overview`),
		),
		// `settings/debug.tsx` is dev-only.
		Match.tag("SettingsDebug", ({ orgSlug }) =>
			options.isProd ? Option.some(`/${orgSlug}/settings`) : Option.none<string>(),
		),
		Match.orElse(() => Option.none<string>()),
	)

/** `_app/layout.tsx` `Gate`: a signed-out visitor on an app route goes to sign-in, then back. */
export const authRedirect = (route: AppRoute, auth: Auth, currentUrl: string): Option.Option<string> =>
	auth === "SignedOut" && !isPublicRoute(route)
		? Option.some(`/sign-in?${new URLSearchParams({ redirect_url: currentUrl })}`)
		: Option.none()

export interface RootMembership {
	readonly organizationId: string
	readonly slug: string | null
}

/** `_app/index.tsx`: where `/` sends a signed-in user once their membership is known. */
export const rootRedirect = (user: CurrentUser, membership: Option.Option<RootMembership>): string => {
	if (!user.isOnboarded)
		return Option.match(membership, {
			onNone: () => "/onboarding",
			onSome: ({ organizationId }) => `/onboarding?${new URLSearchParams({ orgId: organizationId })}`,
		})
	return Option.match(membership, {
		onNone: () => "/select-organization",
		onSome: ({ organizationId, slug }) =>
			slug
				? `/${slug}`
				: `/onboarding/setup-organization?${new URLSearchParams({ orgId: organizationId })}`,
	})
}
