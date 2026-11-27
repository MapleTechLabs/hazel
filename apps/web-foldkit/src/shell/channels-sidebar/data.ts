import type { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import { ChannelSectionId as ChannelSectionIdSchema } from "@hazel/schema"
import { and, eq, inArray, isNull, not, or } from "@tanstack/db"
import { Schema } from "effect"
import type { NotificationLevel } from "~/lib/notification-settings"
import { unreadMuteEnd } from "~/lib/unread"
import {
	channelActivityCollection,
	channelCollection,
	channelCustomerCollection,
	channelMemberCollection,
	channelReadStateCollection,
	channelSectionCollection,
	notificationOverrideCollection,
	organizationCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type {
	ChannelCustomer,
	ChannelEntry,
	DiscoverableChannel,
	Section,
	SidebarChannel,
	SidebarMember,
	OrganizationSetting,
	SectionSetting,
	SidebarThread,
	UnreadChannel,
} from "./rows"

/**
 * The chat sidebar's live queries: the exact query builders of `components/sidebar/*` and the
 * hooks they use, so filtering and row order match legacy.
 */

interface ChannelRow {
	readonly id: ChannelId
	readonly name: string
	readonly type: string
	readonly icon: string | null
	readonly sectionId: ChannelSectionId | null
}
export interface MemberRow {
	readonly id: ChannelMemberId
	readonly userId: UserId
	readonly isMuted: boolean
	readonly mutedUntil?: Date | null
	readonly notificationLevel?: NotificationLevel | null
	readonly isFavorite: boolean
	readonly notificationCount: number
}
interface ChannelMemberRow {
	readonly channel: ChannelRow
	readonly member: MemberRow
}

const toChannel = (row: ChannelRow): SidebarChannel => ({
	id: row.id,
	name: row.name,
	type: row.type,
	icon: row.icon ?? null,
	sectionId: row.sectionId ?? null,
})
export const toMember = (row: MemberRow): SidebarMember => ({
	id: row.id,
	isMuted: row.isMuted,
	mutedUntilMs: row.mutedUntil ? new Date(row.mutedUntil).getTime() : null,
	notificationLevel: row.notificationLevel ?? null,
	isFavorite: row.isFavorite,
	notificationCount: row.notificationCount,
})
const toEntry = (row: ChannelMemberRow): ChannelEntry => ({
	channel: toChannel(row.channel),
	member: toMember(row.member),
})

/** `ChannelsSidebar` sections query. */
export const sectionsStream = <M>(
	organizationId: OrganizationId,
	toMessage: (sections: Array<Section>) => M,
) =>
	liveQueryStream<{ id: ChannelSectionId; name: string }, M>(
		(q) =>
			q
				.from({ section: channelSectionCollection })
				.where((qb) =>
					and(eq(qb.section.organizationId, organizationId), isNull(qb.section.deletedAt)),
				)
				.orderBy(({ section }) => section.order, "asc"),
		(rows) => toMessage(rows.map((row) => ({ id: row.id, name: row.name }))),
	)

/** `ChannelSection`: the user's visible, non-favorite public/private channels in one section. */
export const sectionChannelsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	sectionId: ChannelSectionId | null,
	toMessage: (channels: Array<ChannelEntry>) => M,
) =>
	liveQueryStream<ChannelMemberRow, M>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
					eq(member.channelId, channel.id),
				)
				.where((qb) =>
					and(
						eq(qb.channel.organizationId, organizationId),
						or(eq(qb.channel.type, "public"), eq(qb.channel.type, "private")),
						eq(qb.member.userId, userId),
						eq(qb.member.isHidden, false),
						eq(qb.member.isFavorite, false),
						sectionId === null
							? isNull(qb.channel.sectionId)
							: eq(qb.channel.sectionId, sectionId),
					),
				)
				.orderBy(({ channel }) => channel.createdAt, "asc"),
		(rows) => toMessage(rows.map(toEntry)),
	)

/** `FavoriteSection`. */
export const favoritesStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (channels: Array<ChannelEntry>) => M,
) =>
	liveQueryStream<ChannelMemberRow, M>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
					eq(member.channelId, channel.id),
				)
				.where((q) =>
					and(
						eq(q.channel.organizationId, organizationId),
						eq(q.member.userId, userId),
						eq(q.member.isFavorite, true),
						eq(q.member.isHidden, false),
					),
				)
				.orderBy(({ channel }) => channel.createdAt, "asc"),
		(rows) => toMessage(rows.map(toEntry)),
	)

/**
 * The user's channels with messages they have not read (`~/lib/unread`), sorted, with when their
 * mute ends: the channel's own, its section's or the organization's (as the server's rules count
 * them). Muted for good never shows unread; the view, which has the clock, leaves out the ones
 * muted until later.
 */
export const unreadChannelsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (channels: Array<UnreadChannel>) => M,
) =>
	liveQueryStream<
		{
			channelId: ChannelId
			isMuted: boolean
			mutedUntil: Date | null
			joinedAt: Date
			lastReadAt: Date | null | undefined
			readStateSince: Date | null
			lastMessageAt: Date
			lastMessageAuthorId: UserId
			type: string
			sectionMuted: boolean | undefined
			sectionMutedUntil: Date | null | undefined
			orgMuted: boolean | undefined
			orgMutedUntil: Date | null | undefined
		},
		M
	>(
		(q) =>
			q
				.from({ member: channelMemberCollection })
				.innerJoin({ activity: channelActivityCollection }, ({ member, activity }) =>
					eq(activity.channelId, member.channelId),
				)
				.innerJoin({ channel: channelCollection }, ({ member, channel }) =>
					eq(channel.id, member.channelId),
				)
				.innerJoin({ organization: organizationCollection }, ({ activity, organization }) =>
					eq(organization.id, activity.organizationId),
				)
				// Only the user's own read positions and settings are synced.
				.leftJoin({ read: channelReadStateCollection }, ({ member, read }) =>
					eq(read.channelId, member.channelId),
				)
				.leftJoin({ section: notificationOverrideCollection }, ({ channel, section }) =>
					eq(section.scopeId, channel.sectionId),
				)
				.leftJoin({ org: notificationOverrideCollection }, ({ activity, org }) =>
					eq(org.scopeId, activity.organizationId),
				)
				.where((q) =>
					and(
						eq(q.activity.organizationId, organizationId),
						eq(q.member.userId, userId),
						isNull(q.member.deletedAt),
					),
				)
				.select(({ member, activity, channel, organization, read, section, org }) => ({
					channelId: member.channelId,
					isMuted: member.isMuted,
					mutedUntil: member.mutedUntil,
					joinedAt: member.joinedAt,
					lastReadAt: read?.lastReadAt,
					readStateSince: organization.readStateSince,
					lastMessageAt: activity.lastMessageAt,
					lastMessageAuthorId: activity.lastMessageAuthorId,
					type: channel.type,
					sectionMuted: section?.isMuted,
					sectionMutedUntil: section?.mutedUntil,
					orgMuted: org?.isMuted,
					orgMutedUntil: org?.mutedUntil,
				})),
		(rows) =>
			toMessage(
				rows
					.flatMap((row): Array<UnreadChannel> => {
						const unread = unreadMuteEnd(row, userId)
						return unread === undefined ? [] : [{ channelId: row.channelId, ...unread }]
					})
					.sort((a, b) => a.channelId.localeCompare(b.channelId)),
			),
	)

const decodeSectionId = Schema.decodeSync(ChannelSectionIdSchema)

/** `DmChannelGroup`. */
export const dmChannelIdsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (channelIds: Array<ChannelId>) => M,
) =>
	liveQueryStream<ChannelMemberRow, M>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
					eq(member.channelId, channel.id),
				)
				.where((q) =>
					and(
						eq(q.channel.organizationId, organizationId),
						or(eq(q.channel.type, "direct"), eq(q.channel.type, "single")),
						eq(q.member.userId, userId),
						eq(q.member.isHidden, false),
						eq(q.member.isFavorite, false),
					),
				)
				.orderBy(({ channel }) => channel.createdAt, "asc"),
		(rows) => toMessage(rows.map((row) => row.channel.id)),
	)

/** The org's channels linked to a customer (`channel_customers`), with the customer's name. */
export const channelCustomersStream = <M>(
	organizationId: OrganizationId,
	toMessage: (customers: Array<ChannelCustomer>) => M,
) =>
	liveQueryStream<ChannelCustomer, M>(
		(q) =>
			q
				.from({ customer: channelCustomerCollection })
				.where(({ customer }) => eq(customer.organizationId, organizationId))
				.select(({ customer }) => ({
					channelId: customer.channelId,
					accountName: customer.accountName,
					accountLogoUrl: customer.accountLogoUrl,
				})),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					channelId: row.channelId,
					accountName: row.accountName,
					accountLogoUrl: row.accountLogoUrl ?? null,
				})),
			),
	)
