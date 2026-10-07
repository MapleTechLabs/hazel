import { ChannelId, type NotificationId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { ManagedResource, Subscription } from "foldkit"
import { notificationCollection, organizationCollection, organizationMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import { pageSubscriptions } from "../page/registry"
import { SoundSettings } from "../notification-sound"
import { wireNotificationSinks } from "./notification-sinks"
import { type AppRoute, orgSlugOf } from "../route"
import type { Member, Organization } from "../session"
import * as ShellSubscription from "../shell/subscription"
import * as CommandPalette from "../overlay/command-palette"
import { layoutHotkeys } from "../overlay/hotkeys"
import * as Modal from "../overlay/modal"
import * as Platform from "../platform"
import { clerkAuthStream } from "./clerk"
import { Message } from "./message"
import { type Model, pageHostOf, sharedOf } from "./model"

const rootSubscriptions = Subscription.make<Model, Message>()((entry) => ({
	systemTheme: Subscription.persistent(
		Subscription.fromMediaQuery({
			query: "(prefers-color-scheme: dark)",
			mapMatches: (isDark) => Message.ChangedSystemTheme({ theme: isDark ? "dark" : "light" }),
		}),
	),
	auth: Subscription.persistent(clerkAuthStream.pipe(Stream.map((auth) => Message.ChangedAuth({ auth })))),
	// Legacy `presenceNowSignal`: wall clock for deriving stale presence.
	presenceClock: Subscription.persistent(
		Stream.concat(Stream.succeed(undefined), Stream.tick("30 seconds")).pipe(
			Stream.map(() => Message.TickedPresenceClock({ nowMs: Date.now() })),
		),
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
						),
		},
	),
	// `usePermission()` / `useOrganizationMember()`: the user's row in that org.
	member: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (model) => ({
				organizationId: model.organization?.id ?? null,
				userId: model.currentUser?.id ?? null,
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
									member: member ? { id: member.id, role: member.role } : null,
								})
							},
						),
		},
	),
}))

/** `currentChannelIdAtom`: the channel the chat routes show. */
const currentChannelIdOf = (route: AppRoute): ChannelId | null =>
	route._tag.startsWith("Chat") && "channelId" in route ? route.channelId : null

const MAX_RECENT_NOTIFICATIONS = 250

/** `NotificationSoundProvider` in `$orgSlug/layout.tsx`: sound and native notification sinks. */
const notificationSubscriptions = Subscription.make<Model, Message>()((entry) => ({
	notificationSinks: entry(
		{
			userId: Schema.NullOr(UserId),
			settings: SoundSettings,
			currentChannelId: Schema.NullOr(ChannelId),
		},
		{
			modelToDependencies: (model) => ({
				userId: orgSlugOf(model.route) === undefined ? null : (model.currentUser?.id ?? null),
				settings: model.soundSettings,
				currentChannelId: currentChannelIdOf(model.route),
			}),
			dependenciesToStream: ({ userId, settings, currentChannelId }) =>
				userId === null ? Stream.empty : wireNotificationSinks({ userId, settings, currentChannelId }),
		},
	),
	// The provider's `recentNotifications` query, for the membership in the route's organization.
	recentNotifications: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: (model) => ({ memberId: model.member?.id ?? null }),
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
				isEnabled: model.auth === "SignedIn" && orgSlugOf(model.route) !== undefined,
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
const presenceUserIdOf = (model: Model): UserId | null => {
	const orgSlug = orgSlugOf(model.route)
	return orgSlug !== undefined && model.loadedOrgSlug === orgSlug ? (model.currentUser?.id ?? null) : null
}

const platformSubscriptions = Subscription.lift(Platform.subscriptions)<Model, Message>({
	read: (model) =>
		Option.some({ model: model.platform, userId: presenceUserIdOf(model), pathname: model.pathname }),
	toParentMessage: (message): Message => ({ _tag: "GotPlatformMessage", message }),
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
	shellSubscriptions,
	pages,
	platformSubscriptions,
)

/** App-lifetime managed resources (the Rivet client). */
export const managedResources = ManagedResource.lift(Platform.managedResources)<Model, Message>({
	read: (model) => Option.some(model.platform),
	toParentMessage: (message): Message => ({ _tag: "GotPlatformMessage", message }),
})
