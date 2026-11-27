import { NotificationId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	notificationCollection,
	organizationCollection,
	organizationMemberCollection,
} from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import type { Shared } from "../page/contract"
import { type AppRoute, orgSectionOf } from "../route"
import { isMentionReason } from "../platform/badge"
import * as ChannelsSidebar from "./channels-sidebar"
import * as CustomersSidebar from "./customers-sidebar"
import * as Notifications from "./notifications"
import { Message, type Model } from "./model"

/** What the shell's Subscriptions see: its Model plus the root's route and shared state. */
export interface Input {
	readonly model: Model
	readonly route: AppRoute
	readonly shared: Shared
}

interface OrgRow {
	readonly org: {
		readonly id: OrganizationId
		readonly name: string
		readonly slug?: string | null
		readonly logoUrl?: string | null
	}
}

const own = Subscription.make<Input, Message>()((entry) => ({
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
	// `useUnreadNotificationCount`, with ids: the bell badge and "Mark all as read".
	shellUnreadNotifications: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: ({ shared }) => ({ memberId: shared.member?.id ?? null }),
			dependenciesToStream: ({ memberId }) =>
				memberId === null
					? Stream.empty
					: liveQueryStream<
							{ readonly id: NotificationId; readonly reason: string | null },
							Message
						>(
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
									mentionIds: rows
										.filter((row) => isMentionReason(row.reason))
										.map((row) => row.id),
								}),
							}),
						),
		},
	),
}))

const channelsSidebar = Subscription.lift(ChannelsSidebar.subscriptions)<Input, Message>({
	read: ({ model, route }) =>
		orgSectionOf(route) === "Chat" ? Option.some(model.channelsSidebar) : Option.none(),
	toParentMessage: (message) => Message.GotChannelsSidebarMessage({ message }),
})

/** On every page: the tab title's unread dot reads the sidebar's unread channels. */
const channelsSidebarBadge = Subscription.lift(ChannelsSidebar.badgeSubscriptions)<Input, Message>({
	read: ({ model }) => Option.some(model.channelsSidebar),
	toParentMessage: (message) => Message.GotChannelsSidebarMessage({ message }),
})

/** Only on customers routes: entering the area opens the org's customers source (and keeps it). */
const customersSidebar = Subscription.lift(CustomersSidebar.subscriptions)<Input, Message>({
	read: ({ model, route, shared }) =>
		orgSectionOf(route) === "Customers"
			? Option.some({
					organizationId: shared.organization?.id ?? null,
					userId: shared.currentUser?.id ?? null,
					drag: model.customersSidebar.drag,
				})
			: Option.none(),
	toParentMessage: (message) => Message.GotCustomersSidebarMessage({ message }),
})

export const subscriptions = Subscription.aggregate(
	own,
	channelsSidebar,
	channelsSidebarBadge,
	customersSidebar,
)
