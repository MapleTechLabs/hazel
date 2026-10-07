import { ChannelId, OrganizationMemberId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	channelCollection,
	notificationCollection,
	organizationCollection,
	organizationMemberCollection,
} from "~/db/collections"
import { liveQueryStream } from "../data/live-query"
import type { Shared } from "../page/contract"
import { type AppRoute, orgSectionOf } from "../route"
import * as ChannelsSidebar from "./channels-sidebar"
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

const settingsChannelId = (route: AppRoute) =>
	route._tag === "ChannelSettingsOverview" ||
	route._tag === "ChannelSettingsIntegrations" ||
	route._tag === "ChannelSettingsConnect"
		? route.channelId
		: null

const own = Subscription.make<Input, Message>()((entry) => ({
	// `useMediaQuery("(max-width: 767px)")` in `SidebarProvider`.
	shellViewport: Subscription.persistent(
		Subscription.fromMediaQuery({
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
	// `useUnreadNotificationCount`: the nav rail's bell badge.
	shellUnreadNotifications: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: ({ shared }) => ({ memberId: shared.member?.id ?? null }),
			dependenciesToStream: ({ memberId }) =>
				memberId === null
					? Stream.empty
					: liveQueryStream<unknown, Message>(
							(q) =>
								q
									.from({ notification: notificationCollection })
									.where(({ notification }) =>
										and(eq(notification.memberId, memberId), isNull(notification.readAt)),
									),
							(rows) => Message.UpdatedUnreadNotificationCount({ count: rows.length }),
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
