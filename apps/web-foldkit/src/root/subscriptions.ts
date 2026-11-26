// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shell's Subscriptions, as today's root ones (`git show cd159551c:apps/web-foldkit/src/app/subscription.ts`):
 * the session's facts, the organization and member queries, the viewport, the clock, the keys,
 * the notification sinks and the desktop menu.
 */
import { Router, Subscription } from "@effect/ui"
import type { NotificationId } from "@hazel/schema"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { eq, isNull } from "@tanstack/db"
import { Clock, Duration, Option, Schema, Stream } from "effect"
import { Dom } from "foldkit"
import { notificationCollection, organizationCollection, organizationMemberCollection } from "~/db/collections"
import { appOrgSourcesSettled, syncSession } from "~/db/sync-manager"
import { SESSION_REJECTED_EVENT } from "~/lib/access-token"
import { wireNotificationSinks } from "../app/notification-sinks"
import { REMEMBERED_USER_KEY } from "../app/remembered-user"
import { liveQueryStream } from "../data/live-query"
import { layoutHotkeys, layoutKeysOf } from "../overlay/hotkeys"
import { isMentionReason } from "../platform/badge"
import { desktopMenuItems } from "../platform/desktop-menu"
import { chatChannelIdOf, isChatRoute, orgSlugOf } from "../route"
import type { Member, Organization } from "../session"
import { MOBILE_QUERY } from "../ui/viewport"
import * as Bus from "./bus"
import { type AppModel, currentUserOf, isShellReady, keysOf, memberOf, organizationOf } from "./logic"
import { AppMessage } from "./message"
import { AppRoutes } from "./routes"
import { authOf } from "./state"

/** How often the clock ticks (legacy `presenceNowSignal` and the sidebar's presence dots). */
const CLOCK_INTERVAL = Duration.seconds(30)

const MAX_RECENT_NOTIFICATIONS = 250

const mediaQuery = (query: string) =>
	Dom.streamFromMediaQuery({ query, mapMatches: (matches: boolean) => matches })

export const subscriptions = ({ model }: { readonly model: AppModel }) => {
	const user = currentUserOf(model)
	const userId = user?.id ?? null
	const isSignedIn = authOf(model.session) === "SignedIn"
	const orgSlug = orgSlugOf(model.route) ?? null
	const organizationId = organizationOf(model)?.id ?? null
	const memberId = memberOf(model)?.id ?? null
	const isOverlayOpen = model.report?.isOverlayOpen ?? false
	return [
		Router.subscription(AppRoutes, model.route, (route) => AppMessage.ChangedRoute({ route })),
		Subscription.make("systemTheme", [], () =>
			mediaQuery("(prefers-color-scheme: dark)").pipe(
				Stream.map((isDark) => AppMessage.ChangedSystemTheme({ theme: isDark ? "dark" : "light" })),
			),
		),
		// `useMediaQuery("(max-width: 767px)")` in `SidebarProvider`.
		Subscription.make("viewport", [], () =>
			mediaQuery(MOBILE_QUERY).pipe(Stream.map((isMobile) => AppMessage.ChangedViewport({ isMobile }))),
		),
		// The one wall clock (presence staleness, status expiry), ticking only while the org shell shows.
		Subscription.make("clock", [isShellReady(model)], ([isTicking]) =>
			isTicking
				? Stream.concat(Stream.succeed(undefined), Stream.tick(CLOCK_INTERVAL)).pipe(
						Stream.mapEffect(() => Clock.currentTimeMillis),
						Stream.map((nowMs) => AppMessage.TickedClock({ nowMs })),
					)
				: Stream.empty,
		),
		// The sync sources of the signed-in user (`core/db/sync-manager.ts`), once `user.me` answered.
		Subscription.make("sync", [userId], ([id]) =>
			id === null ? Stream.empty : syncSession(UserId.make(id)).pipe(Stream.drain),
		),
		// Every source retries a refused token at once; one session check covers them all.
		Subscription.make("sessionRejected", [isSignedIn], ([signedIn]) =>
			signedIn
				? Stream.fromEventListener(window, SESSION_REJECTED_EVENT).pipe(
						Stream.throttle({ cost: () => 1, units: 1, duration: Duration.seconds(30), strategy: "enforce" }),
						Stream.map(() => AppMessage.RejectedSession()),
					)
				: Stream.empty,
		),
		// Another tab forgot the remembered user: this one checks the session and asks whose it is now.
		Subscription.make("sessionEndedElsewhere", [isSignedIn], ([signedIn]) =>
			signedIn
				? Stream.fromEventListener<StorageEvent>(window, "storage").pipe(
						Stream.filter((event) => event.key === REMEMBERED_USER_KEY && event.newValue === null),
						Stream.flatMap(() =>
							Stream.make(AppMessage.RejectedSession(), AppMessage.PressedRetryCurrentUser()),
						),
					)
				: Stream.empty,
		),
		// `useOrganization()`: the org named by the route's slug.
		Subscription.make("organization", [orgSlug], ([slug]) =>
			slug === null
				? Stream.empty
				: liveQueryStream<Organization, AppMessage>(
						(q) =>
							q
								.from({ org: organizationCollection })
								.where(({ org }) => eq(org.slug, slug))
								.orderBy(({ org }) => org.createdAt, "asc")
								.findOne(),
						(rows) => {
							const org = rows[0]
							return AppMessage.UpdatedOrganization({
								orgSlug: slug,
								organization: org
									? { id: org.id, name: org.name, slug: org.slug ?? null, logoUrl: org.logoUrl ?? null }
									: null,
							})
						},
						{
							onStalled: () => AppMessage.StalledOrganization({ orgSlug: slug }),
							// The org sources start as last load's set: an org joined since is missing
							// until its own source answers, not "not found".
							holdEmptyUntil: appOrgSourcesSettled,
						},
					),
		),
		// `usePermission()` / `useOrganizationMember()`: the user's row in that org.
		Subscription.make("member", [organizationId, userId], ([orgId, id]) =>
			orgId === null || id === null
				? Stream.empty
				: liveQueryStream<Member, AppMessage>(
						(q) =>
							q
								.from({ m: organizationMemberCollection })
								.where(({ m }) => eq(m.organizationId, orgId))
								.where(({ m }) => eq(m.userId, id))
								.findOne(),
						(rows) => {
							const member = rows[0]
							return AppMessage.UpdatedMember({
								organizationId: OrganizationId.make(orgId),
								member: member ? { id: member.id, role: member.role } : null,
							})
						},
					),
		),
		// `NotificationSoundProvider` in `$orgSlug/layout.tsx`: sound and native notification sinks.
		Subscription.make(
			"notificationSinks",
			[
				orgSlug === null ? null : userId,
				JSON.stringify(model.soundSettings),
				chatChannelIdOf(model.route),
				model.sessionStartMs,
			],
			([id, settings, currentChannelId, sessionStartMs]) =>
				id === null
					? Stream.empty
					: wireNotificationSinks({
							userId: UserId.make(id),
							settings: JSON.parse(settings),
							currentChannelId: currentChannelId === null ? null : (currentChannelId as never),
							sessionStartMs,
						}),
		),
		// Every unread notification of the user, in any organization: the badges' mention count.
		Subscription.make("unreadMentions", [userId], ([id]) =>
			id === null
				? Stream.empty
				: liveQueryStream<{ readonly id: NotificationId; readonly reason: string | null }, AppMessage>(
						(q) =>
							q.from({ notification: notificationCollection }).where(({ notification }) => isNull(notification.readAt)),
						(rows) =>
							AppMessage.UpdatedUnreadMentions({
								ids: rows.filter((row) => isMentionReason(row.reason)).map((row) => row.id),
							}),
					),
		),
		// The provider's `recentNotifications` query, for the membership in the route's organization.
		Subscription.make("recentNotifications", [memberId], ([id]) =>
			id === null
				? Stream.empty
				: liveQueryStream<{ readonly id: NotificationId }, AppMessage>(
						(q) =>
							q
								.from({ notification: notificationCollection })
								.where(({ notification }) => eq(notification.memberId, OrganizationMemberId.make(id)))
								.orderBy(({ notification }) => notification.createdAt, "desc")
								.limit(MAX_RECENT_NOTIFICATIONS),
						(rows) => AppMessage.UpdatedRecentNotifications({ ids: rows.map((row) => row.id) }),
					),
		),
		// `$orgSlug/layout.tsx` hotkeys: only inside the signed-in org shell.
		Subscription.make(
			"layoutHotkeys",
			[
				isSignedIn && orgSlug !== null,
				isChatRoute(model.route) && !isOverlayOpen,
				isOverlayOpen,
				JSON.stringify(layoutKeysOf(keysOf(model))),
			],
			([isEnabled, isChannelNavigationEnabled, overlayOpen, keys]) =>
				isEnabled
					? layoutHotkeys((actionId) => AppMessage.PressedHotkey({ actionId }), JSON.parse(keys), {
							isChannelNavigationEnabled,
							isOverlayOpen: overlayOpen,
						})
					: Stream.empty,
		),
		Subscription.make("desktopMenu", [], () =>
			desktopMenuItems.pipe(Stream.map((item) => AppMessage.PressedDesktopMenuItem({ item }))),
		),
	]
}


