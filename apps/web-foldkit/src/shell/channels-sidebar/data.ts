import type { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, inArray, isNull, not, or } from "@tanstack/db"
import { channelCollection, channelMemberCollection, channelSectionCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import type { ChannelEntry, DiscoverableChannel, Section, SidebarChannel, SidebarMember } from "./rows"

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

/** `DiscoverableChannels`, first query: top-level public/private channels the user belongs to. */
export const memberChannelIdsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (channelIds: Array<ChannelId>) => M,
) =>
	liveQueryStream<{ channelId: ChannelId }, M>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.innerJoin({ m: channelMemberCollection }, ({ channel, m }) => eq(m.channelId, channel.id))
				.where(({ m, channel }) =>
					and(
						eq(m.userId, userId),
						eq(channel.organizationId, organizationId),
						or(eq(channel.type, "public"), eq(channel.type, "private")),
						isNull(channel.parentChannelId),
					),
				)
				.select(({ m }) => ({ channelId: m.channelId })),
		(rows) => toMessage(rows.map((row) => row.channelId)),
	)

/** `DiscoverableChannels`, second query: public top-level channels the user hasn't joined. */
export const discoverableChannelsStream = <M>(
	organizationId: OrganizationId,
	memberChannelIds: ReadonlyArray<ChannelId>,
	toMessage: (channels: Array<DiscoverableChannel>) => M,
) =>
	liveQueryStream<ChannelRow, M>(
		(q) => {
			let query = q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.organizationId, organizationId))
				.where(({ channel }) => eq(channel.type, "public"))
				.where(({ channel }) => isNull(channel.parentChannelId))
			if (memberChannelIds.length > 0) {
				query = query.where(({ channel }) => not(inArray(channel.id, [...memberChannelIds])))
			}
			return query
				.orderBy(({ channel }) => channel.createdAt, "asc")
				.select(({ channel }) => ({ ...channel }))
		},
		(rows) => toMessage(rows.map((row) => ({ id: row.id, name: row.name, icon: row.icon ?? null }))),
	)
