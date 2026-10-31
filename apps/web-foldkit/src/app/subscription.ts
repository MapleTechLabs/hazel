import { ChannelId, type NotificationId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Clock, Duration, Option, Schema, Stream } from "effect"
import { Dom, Subscription } from "foldkit"
import {
	notificationCollection,
	organizationCollection,
	organizationMemberCollection,
} from "~/db/collections"
import { appOrgSourcesSettled, syncSession } from "~/db/sync-manager"
import { SESSION_REJECTED_EVENT } from "~/lib/access-token"
import { liveQueryStream } from "../data/live-query"
import { pageSubscriptions } from "../page/registry"
import { SoundSettings } from "../notification-sound"
import { type NotificationSinks, wireNotificationSinks } from "./notification-sinks"
import { chatChannelIdOf, orgSlugOf } from "../route"
import type { Member, Organization } from "../session"
import * as ShellSubscription from "../shell/subscription"
import * as CommandPalette from "../overlay/command-palette"
import { layoutHotkeys } from "../overlay/hotkeys"
import * as Modal from "../overlay/modal"
import * as Platform from "../platform"
import { desktopMenuItems } from "../platform/desktop-menu"
import * as Updates from "../platform/updates"
import * as Toasts from "../overlay/toaster"
import { Message } from "./message"
import { authOf, currentUserOf, loadedOrgOf, memberOf, type Model, pageHostOf, sharedOf } from "./model"

/** `useSidebar().isMobile`: the viewport the mobile layout is for. */
export const MOBILE_QUERY = "(max-width: 767px)"

/** How often the root clock ticks (legacy `presenceNowSignal` and the sidebar's presence dots). */
const CLOCK_INTERVAL = Duration.seconds(30)

/** The org shell is up: the session, its user and the route's organization have loaded. */
const isShellReady = (model: Model): boolean =>
	currentUserOf(model) !== null && Option.isSome(loadedOrgOf(model))

const rootSubscriptions = Subscription.make<Model, Message>()((entry) => ({
	systemTheme: Subscription.persistentEntry(
		Dom.streamFromMediaQuery({
			query: "(prefers-color-scheme: dark)",
			mapMatches: (isDark) => Message.ChangedSystemTheme({ theme: isDark ? "dark" : "light" }),
		}),
	),
	// `useMediaQuery("(max-width: 767px)")` in `SidebarProvider`.
	viewport: Subscription.persistentEntry(
		Dom.streamFromMediaQuery({
			query: MOBILE_QUERY,
			mapMatches: (isMobile) => Message.ChangedViewport({ isMobile }),
		}),
	),
	// The one wall clock (presence staleness, status expiry), ticking only while the org shell shows.
	clock: entry(
		{ isTicking: Schema.Boolean },
		{
			modelToDependencies: (model) => ({ isTicking: isShellReady(model) }),
			dependenciesToStream: ({ isTicking }) =>
				isTicking
					? Stream.concat(Stream.succeed(undefined), Stream.tick(CLOCK_INTERVAL)).pipe(
							Stream.mapEffect(() => Clock.currentTimeMillis),
							Stream.map((nowMs) => Message.TickedClock({ nowMs })),
						)
					: Stream.empty,
		},
	),
	// The sync sources of the signed-in user (`core/db/sync-manager.ts`), once `user.me` answered.
	sync: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (model) => ({ userId: currentUserOf(model)?.id ?? null }),
			dependenciesToStream: ({ userId }) => (userId === null ? Stream.empty : syncSession(userId)),
		},
	),
	// Every source retries a refused token at once; one session check covers them all.
	sessionRejected: entry(
		{ isSignedIn: Schema.Boolean },
		{
			modelToDependencies: (model) => ({ isSignedIn: authOf(model.session) === "SignedIn" }),
			dependenciesToStream: ({ isSignedIn }) =>
				isSignedIn
					? Stream.fromEventListener(window, SESSION_REJECTED_EVENT).pipe(
							Stream.throttle({
								cost: () => 1,
								units: 1,
								duration: Duration.seconds(30),
								strategy: "enforce",
							}),
							Stream.map(() => Message.RejectedSession()),
						)
					: Stream.empty,
		},
	),
	// `useOrganization()`: the org named by the route's slug.
	organization: entry(
		{ orgSlug: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: (model) => ({ orgSlug: orgSlugOf(model.route) ?? null }),
			dependenciesToStream: ({ orgSlug }) =>
				orgSlug === null
					? Stream.empty
					: liveQueryStream<Organization, Message>(
							(q) =>
								q
									.from({ org: organizationCollection })
									.where(({ org }) => eq(org.slug, orgSlug))
									.orderBy(({ org }) => org.createdAt, "asc")
									.findOne(),
							(rows) => {
								const org = rows[0]
								return Message.UpdatedOrganization({
									orgSlug,
									organization: org
										? {
												id: org.id,
												name: org.name,
												slug: org.slug ?? null,
												logoUrl: org.logoUrl ?? null,
											}
										: null,
								})
							},
							{
								onStalled: () => Message.StalledOrganization({ orgSlug }),
								// The org sources start as last load's set: an org joined since is
								// missing until its own source answers, not "not found".
								holdEmptyUntil: appOrgSourcesSettled,
							},
						),
		},
	),
	// `usePermission()` / `useOrganizationMember()`: the user's row in that org.
	member: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (model) => ({
				organizationId: Option.getOrNull(
					Option.map(loadedOrgOf(model), (org) => org.organization.id),
				),
				userId: currentUserOf(model)?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId, userId }) =>
				organizationId === null || userId === null
					? Stream.empty
					: liveQueryStream<Member, Message>(
							(q) =>
								q
									.from({ m: organizationMemberCollection })
									.where(({ m }) => eq(m.organizationId, organizationId))
									.where(({ m }) => eq(m.userId, userId))
									.findOne(),
							(rows) => {
								const member = rows[0]
								return Message.UpdatedMember({
									organizationId,
									member: member ? { id: member.id, role: member.role } : null,
								})
							},
						),
		},
	),
}))

const MAX_RECENT_NOTIFICATIONS = 250

/** `NotificationSoundProvider` in `$orgSlug/layout.tsx`: sound and native notification sinks. */
const notificationSubscriptions = Subscription.make<Model, Message, NotificationSinks>()((entry) => ({
	notificationSinks: entry(
		{
			userId: Schema.NullOr(UserId),
			settings: SoundSettings,
			currentChannelId: Schema.NullOr(ChannelId),
			sessionStartMs: Schema.Number,
		},
		{
			modelToDependencies: (model) => ({
				userId: orgSlugOf(model.route) === undefined ? null : (currentUserOf(model)?.id ?? null),
				settings: model.soundSettings,
				currentChannelId: chatChannelIdOf(model.route),
				sessionStartMs: model.sessionStartMs,
			}),
			dependenciesToStream: ({ userId, settings, currentChannelId, sessionStartMs }) =>
				userId === null
					? Stream.empty
					: wireNotificationSinks({ userId, settings, currentChannelId, sessionStartMs }),
		},
	),
	// The provider's `recentNotifications` query, for the membership in the route's organization.
	recentNotifications: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: (model) => ({ memberId: memberOf(model)?.id ?? null }),
			dependenciesToStream: ({ memberId }) =>
				memberId === null
					? Stream.empty
					: liveQueryStream<{ readonly id: NotificationId }, Message>(
							(q) =>
								q
									.from({ notification: notificationCollection })
									.where(({ notification }) => eq(notification.memberId, memberId))
									.orderBy(({ notification }) => notification.createdAt, "desc")
									.limit(MAX_RECENT_NOTIFICATIONS),
							(rows) => Message.UpdatedRecentNotifications({ ids: rows.map((row) => row.id) }),
						),
		},
	),
}))

const overlaySubscriptions = Subscription.make<Model, Message>()((entry) => ({
	// `$orgSlug/layout.tsx` hotkeys: only inside the signed-in org shell.
	layoutHotkeys: entry(
		{ isEnabled: Schema.Boolean },
		{
			modelToDependencies: (model) => ({
				isEnabled: authOf(model.session) === "SignedIn" && orgSlugOf(model.route) !== undefined,
			}),
			dependenciesToStream: ({ isEnabled }) =>
				isEnabled ? layoutHotkeys((actionId) => Message.PressedHotkey({ actionId })) : Stream.empty,
		},
	),
}))

const commandPaletteSubscriptions = Subscription.lift(CommandPalette.subscriptions)<Model, Message>({
	read: (model) => Option.some({ model: model.commandPalette, shared: sharedOf(model) }),
	toParentMessage: (message): Message => ({ _tag: "GotCommandPaletteMessage", message }),
})

const modalSubscriptions = Subscription.lift(Modal.subscriptions)<Model, Message>({
	read: (model) => Option.some({ modal: model.modal, shared: sharedOf(model) }),
	toParentMessage: (message): Message => ({ _tag: "GotModalMessage", message }),
})

const shellSubscriptions = Subscription.lift(ShellSubscription.subscriptions)<Model, Message>({
	read: (model) => Option.some({ model: model.shell, route: model.route, shared: sharedOf(model) }),
	// Literal wrappers: constructors would re-validate every row payload.
	toParentMessage: (message): Message => ({ _tag: "GotShellMessage", message }),
})

/** `PresenceProvider` runs inside the loaded `$orgSlug` layout, once `user.me` answered. */
const presenceUserIdOf = (model: Model): UserId | null =>
	isShellReady(model) ? (currentUserOf(model)?.id ?? null) : null

const platformSubscriptions = Subscription.lift(Platform.subscriptions)<Model, Message>({
	read: (model) =>
		Option.some({
			model: model.platform,
			userId: presenceUserIdOf(model),
			activeChannelId: chatChannelIdOf(model.route),
		}),
	toParentMessage: (message): Message => ({ _tag: "GotPlatformMessage", message }),
})

const updateSubscriptions = Subscription.lift(Updates.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.desktopUpdate),
	toParentMessage: (message): Message => ({ _tag: "GotUpdatesMessage", message }),
})

const desktopMenuSubscriptions = Subscription.make<Model, Message>()(() => ({
	desktopMenu: Subscription.persistentEntry(
		desktopMenuItems.pipe(Stream.map((item) => Message.PressedDesktopMenuItem({ item }))),
	),
}))

const toastSubscriptions = Subscription.lift(Toasts.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.toasts),
	toParentMessage: (message): Message => ({ _tag: "GotToastsMessage", message }),
})

const pages = Subscription.lift(pageSubscriptions)<Model, Message>({
	read: (model) => Option.some(pageHostOf(model)),
	toParentMessage: (message): Message => ({ _tag: "GotPageMessage", message }),
})

export const subscriptions = Subscription.aggregate(
	rootSubscriptions,
	notificationSubscriptions,
	overlaySubscriptions,
	commandPaletteSubscriptions,
	modalSubscriptions,
	toastSubscriptions,
	shellSubscriptions,
	pages,
	platformSubscriptions,
	updateSubscriptions,
	desktopMenuSubscriptions,
)
