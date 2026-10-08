import { ChannelId, NotificationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Dom, Subscription } from "foldkit"
import {
	channelCollection,
	notificationCollection,
	organizationCollection,
	organizationMemberCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import type { Shared } from "../page/contract"
import { type AppRoute, orgSectionOf } from "../route"
import * as ChannelsSidebar from "./channels-sidebar"
import * as Notifications from "./notifications"
import { type ChannelSummary, Message, type Model } from "./model"

/** What the shell's Subscriptions see: its Model plus the root's route and shared state. */
export interface Input {
	readonly model: Model
	readonly route: AppRoute
	readonly shared: Shared
}

interface OrgRow {
	readonly org: {
		readonly id: string
		readonly name: string
		readonly slug?: string | null
		readonly logoUrl?: string | null
	}
}

interface PresenceRow {
	readonly statusEmoji?: string | null
	readonly customMessage?: string | null
	readonly statusExpiresAt?: Date | null
}

const settingsChannelId = (route: AppRoute) =>
	route._tag === "ChannelSettingsOverview" ||
	route._tag === "ChannelSettingsIntegrations" ||
	route._tag === "ChannelSettingsConnect"
		? route.channelId
		: null

const own = Subscription.make<Input, Message>()((entry) => ({
	// `useMediaQuery("(max-width: 767px)")` in `SidebarProvider`.
	shellViewport: Subscription.persistentEntry(
		Dom.streamFromMediaQuery({
			query: "(max-width: 767px)",
			mapMatches: (isMobile) => Message.ChangedViewport({ isMobile }),
		}),
	),
	// `SwitchServerMenu`: every organization the user belongs to, oldest membership first.
	shellUserOrganizations: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<OrgRow, Message>(
							(q) =>
								q
									.from({ member: organizationMemberCollection })
									.innerJoin({ org: organizationCollection }, ({ member, org }) =>
										eq(member.organizationId, org.id),
									)
									.where(({ member }) => eq(member.userId, userId))
									.orderBy(({ member }) => member.createdAt, "asc"),
							(rows) =>
								Message.UpdatedUserOrganizations({
									organizations: rows.map(({ org }) => ({
										id: org.id,
										name: org.name,
										slug: org.slug ?? null,
										logoUrl: org.logoUrl ?? null,
									})),
								}),
						),
		},
	),
	// `useCurrentUserStatus`: the user's newest presence row (`currentUserPresenceAtomFamily`).
	shellUserStatus: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({ userId: shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<PresenceRow, Message>(
							(q) =>
								q
									.from({ presence: userPresenceStatusCollection })
									.where(({ presence }) => eq(presence.userId, userId))
									.orderBy(({ presence }) => presence.updatedAt, "desc")
									.findOne(),
							(rows) => {
								const row = rows[0]
								return Message.UpdatedUserStatus({
									status:
										row === undefined
											? null
											: {
													emoji: row.statusEmoji ?? null,
													message: row.customMessage ?? null,
													expiresAtMs: row.statusExpiresAt?.getTime() ?? null,
												},
								})
							},
						),
		},
	),
	// `useUnreadNotificationCount`, with ids: the bell badge and "Mark all as read".
	shellUnreadNotifications: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: ({ shared }) => ({ memberId: shared.member?.id ?? null }),
			dependenciesToStream: ({ memberId }) =>
				memberId === null
					? Stream.empty
					: liveQueryStream<{ readonly id: NotificationId }, Message>(
							(q) =>
								q
									.from({ notification: notificationCollection })
									.where(({ notification }) =>
										and(eq(notification.memberId, memberId), isNull(notification.readAt)),
									),
							(rows): Message => ({
								_tag: "GotNotificationsMessage",
								message: Notifications.Message.UpdatedUnreadNotifications({
									ids: rows.map((row) => row.id),
								}),
							}),
						),
		},
	),
	shellSettingsChannel: entry(
		{ channelId: Schema.NullOr(ChannelId) },
		{
			modelToDependencies: ({ route }) => ({ channelId: settingsChannelId(route) }),
			dependenciesToStream: ({ channelId }) =>
				channelId === null
					? Stream.empty
					: liveQueryStream<ChannelSummary, Message>(
							(q) =>
								q
									.from({ channel: channelCollection })
									.where(({ channel }) => eq(channel.id, channelId))
									.findOne(),
							(rows) => {
								const channel = rows[0]
								return Message.UpdatedSettingsChannel({
									channel: channel
										? { id: channel.id, name: channel.name, icon: channel.icon ?? null }
										: null,
								})
							},
						),
		},
	),
}))

const channelsSidebar = Subscription.lift(ChannelsSidebar.subscriptions)<Input, Message>({
	read: ({ model, route }) =>
		orgSectionOf(route) === "Chat" ? Option.some(model.channelsSidebar) : Option.none(),
	toParentMessage: (message) => Message.GotChannelsSidebarMessage({ message }),
})

export const subscriptions = Subscription.aggregate(own, channelsSidebar)
