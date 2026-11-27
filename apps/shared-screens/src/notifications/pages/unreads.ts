/**
 * The inbox's Unreads tab (`web-foldkit/src/page/notifications/inbox`, now deleted): the user's
 * channels with someone else's message after their read position, with the sidebar's mute rules.
 */
import { ChannelId, type OrganizationId, type UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Schema } from "effect"
import { liveQuery } from "../../app/live"
import { type UnreadChannelMutes, unreadMuteEnd } from "../../lib/unread"

export const UnreadChannel = Schema.Struct({
	channelId: ChannelId,
	name: Schema.String,
	type: Schema.String,
	/** The member's `notificationCount`: mentions (and DMs) not yet read. */
	mentionCount: Schema.Finite,
	lastMessageAtMs: Schema.Finite,
	/** A timed mute; the view, which has the clock, leaves the channel out until it ends. */
	mutedUntilMs: Schema.NullOr(Schema.Finite),
})
export type UnreadChannel = typeof UnreadChannel.Type

/**
 * A channel marked read here whose read position has not synced back yet: hidden while its newest
 * message is no newer than when it was marked, so a message after that shows it again.
 */
export const MarkedRead = Schema.Struct({ channelId: ChannelId, upToMs: Schema.Finite })
export type MarkedRead = typeof MarkedRead.Type

export interface UnreadChannelRow extends UnreadChannelMutes {
	readonly channelId: ChannelId
	readonly name: string
	readonly notificationCount: number
}

/** The rows the user has not read, as Unreads items (the view sorts them). */
export const toUnreadChannels = (
	rows: ReadonlyArray<UnreadChannelRow>,
	userId: UserId,
): Array<UnreadChannel> =>
	rows.flatMap((row) => {
		const unread = unreadMuteEnd(row, userId)
		return unread === undefined
			? []
			: [
					{
						channelId: row.channelId,
						name: row.name,
						type: row.type,
						mentionCount: row.notificationCount,
						lastMessageAtMs: new Date(row.lastMessageAt).getTime(),
						mutedUntilMs: unread.mutedUntilMs,
					},
				]
	})

/** The sidebar's unread join with each channel's name and the member's mention count. */
export const unreadChannelsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	to: (channels: Array<UnreadChannel>) => M,
) =>
	liveQuery<UnreadChannelRow, M>(
		({ collections: c }) =>
			(q) =>
				q
					.from({ member: c.channelMemberCollection })
					.innerJoin({ activity: c.channelActivityCollection }, ({ member, activity }) =>
						eq(activity.channelId, member.channelId),
					)
					.innerJoin({ channel: c.channelCollection }, ({ member, channel }) =>
						eq(channel.id, member.channelId),
					)
					.innerJoin({ organization: c.organizationCollection }, ({ activity, organization }) =>
						eq(organization.id, activity.organizationId),
					)
					// Only the user's own read positions and settings are synced.
					.leftJoin({ read: c.channelReadStateCollection }, ({ member, read }) =>
						eq(read.channelId, member.channelId),
					)
					.leftJoin({ section: c.notificationOverrideCollection }, ({ channel, section }) =>
						eq(section.scopeId, channel.sectionId),
					)
					.leftJoin({ org: c.notificationOverrideCollection }, ({ activity, org }) =>
						eq(org.scopeId, activity.organizationId),
					)
					.where((q) =>
						and(
							eq(q.activity.organizationId, organizationId),
							eq(q.member.userId, userId),
							eq(q.member.isMuted, false),
							isNull(q.member.deletedAt),
							isNull(q.channel.deletedAt),
						),
					)
					.select(({ member, activity, channel, organization, read, section, org }) => ({
						channelId: member.channelId,
						name: channel.name,
						type: channel.type,
						notificationCount: member.notificationCount,
						isMuted: member.isMuted,
						mutedUntil: member.mutedUntil,
						joinedAt: member.joinedAt,
						lastReadAt: read?.lastReadAt,
						readStateSince: organization.readStateSince,
						lastMessageAt: activity.lastMessageAt,
						lastMessageAuthorId: activity.lastMessageAuthorId,
						sectionMuted: section?.isMuted,
						sectionMutedUntil: section?.mutedUntil,
						orgMuted: org?.isMuted,
						orgMutedUntil: org?.mutedUntil,
					})),
		(rows) => to(toUnreadChannels(rows, userId)),
	)

/** The rows shown: not muted at `nowMs`, not marked read here since their newest message, newest first. */
export const visibleUnreadChannels = (
	channels: ReadonlyArray<UnreadChannel>,
	markedRead: ReadonlyArray<MarkedRead>,
	nowMs: number,
): ReadonlyArray<UnreadChannel> =>
	channels
		.filter((channel) => channel.mutedUntilMs === null || channel.mutedUntilMs <= nowMs)
		.filter(
			(channel) =>
				!markedRead.some(
					(marked) =>
						marked.channelId === channel.channelId && channel.lastMessageAtMs <= marked.upToMs,
				),
		)
		.toSorted((a, b) => b.lastMessageAtMs - a.lastMessageAtMs)

/** A row's title: a direct message's channel may have no name of its own. */
export const unreadChannelTitle = (channel: UnreadChannel): string => {
	if (channel.name === "") return channel.type === "thread" ? "Thread" : "Direct message"
	return channel.type === "public" || channel.type === "private" ? `#${channel.name}` : channel.name
}

export const unreadChannelDetail = (channel: UnreadChannel): string => {
	if (channel.mentionCount === 0) return "New messages"
	return channel.mentionCount === 1 ? "1 mention" : `${channel.mentionCount} mentions`
}

/** Marks the channels read up to their newest message, until the read position syncs back. */
export const markRead = (
	current: ReadonlyArray<MarkedRead>,
	channels: ReadonlyArray<UnreadChannel>,
	channelIds: ReadonlyArray<ChannelId>,
): ReadonlyArray<MarkedRead> => [
	...current.filter((entry) => !channelIds.includes(entry.channelId)),
	...channels.flatMap((channel) =>
		channelIds.includes(channel.channelId)
			? [{ channelId: channel.channelId, upToMs: channel.lastMessageAtMs }]
			: [],
	),
]

/** A mark that left the unread rows, or that a newer message outdated, is no longer needed. */
export const keptMarks = (
	current: ReadonlyArray<MarkedRead>,
	channels: ReadonlyArray<UnreadChannel>,
): ReadonlyArray<MarkedRead> =>
	current.filter((entry) =>
		channels.some(
			(channel) => channel.channelId === entry.channelId && channel.lastMessageAtMs <= entry.upToMs,
		),
	)
