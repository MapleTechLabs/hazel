import type {
	ChannelId,
	ConnectConversationId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { and, createCollection, eq, inArray, isNull, liveQueryCollectionOptions } from "@tanstack/db"
import { Stream } from "effect"
import {
	channelCollection,
	channelMemberCollection,
	connectConversationChannelCollection,
	notificationCollection,
	organizationCollection,
	organizationMemberCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { type MemberRow, toMember } from "./data"
import type { ConnectMount, DmChannel, Membership, PartnerOrg, Presence, UnreadCount } from "./rows"

/** The sidebar's queries about people: membership, unread counts, DM rows, presence, Connect partners. */

/** `db/materialized-collections.ts`, rebuilt on `@tanstack/db` core so React stays out of the bundle. */
const channelMemberWithUserCollection = createCollection(
	liveQueryCollectionOptions({
		query: (q) =>
			q
				.from({ member: channelMemberCollection })
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.select(({ member, user }) => ({ ...member, user })),
	}),
)

/** `useOrganizationMember` / `usePermission`: the signed-in user's org membership. */
export const membershipStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	toMessage: (membership: Membership | null) => M,
) =>
	liveQueryStream<Membership, M>(
		(q) =>
			q
				.from({ member: organizationMemberCollection })
				.where(({ member }) =>
					and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
				)
				.findOne(),
		(rows) => toMessage(rows[0] ? { id: rows[0].id, role: rows[0].role } : null),
	)

interface DmMemberRow extends MemberRow {
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

/** `useChannelWithCurrentUser`, per DM row. Null until the signed-in user's membership is present. */
export const dmChannelStream = <M>(
	channelId: ChannelId,
	userId: UserId,
	toMessage: (channel: DmChannel | null) => M,
) =>
	liveQueryStream<{ channel: { readonly id: ChannelId; readonly type: string }; member: DmMemberRow }, M>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where((t) => eq(t.channel.id, channelId))
				.innerJoin({ member: channelMemberWithUserCollection }, ({ channel, member }) =>
					eq(channel.id, member.channelId),
				),
		(rows) => {
			const first = rows[0]
			const current = rows.find((row) => row.member.userId === userId)
			return toMessage(
				first && current
					? {
							id: first.channel.id,
							type: first.channel.type,
							members: rows.map(({ member }) => ({
								userId: member.userId,
								firstName: member.user.firstName,
								lastName: member.user.lastName,
								avatarUrl: member.user.avatarUrl ?? null,
							})),
							currentUser: toMember(current.member),
						}
					: null,
			)
		},
	)

/** Every DM row's query, merged; each emission names its channel. */
export const dmChannelsStream = <M>(
	channelIds: ReadonlyArray<ChannelId>,
	userId: UserId,
	toMessage: (channelId: ChannelId, channel: DmChannel | null) => M,
) =>
	Stream.mergeAll(
		channelIds.map((channelId) =>
			dmChannelStream(channelId, userId, (channel) => toMessage(channelId, channel)),
		),
		{ concurrency: "unbounded" },
	)

interface PresenceRow {
	readonly userId: UserId
	readonly status: string | null
	readonly statusEmoji: string | null
	readonly lastSeenAt: Date | null
}

/** `currentUserPresenceAtomFamily` for each DM partner: newest presence row per user. */
export const presenceStream = <M>(
	userIds: ReadonlyArray<UserId>,
	toMessage: (presence: Array<Presence>) => M,
) =>
	liveQueryStream<PresenceRow, M>(
		(q) =>
			q
				.from({ presence: userPresenceStatusCollection })
				.where(({ presence }) => inArray(presence.userId, [...userIds]))
				.orderBy(({ presence }) => presence.updatedAt, "desc"),
		(rows) => {
			const seen = new Set<UserId>()
			const latest = rows.filter((row) => !seen.has(row.userId) && seen.add(row.userId))
			return toMessage(
				latest.map((row) => ({
					userId: row.userId,
					status: row.status ?? null,
					lastSeenMs: row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : null,
					statusEmoji: row.statusEmoji ?? null,
				})),
			)
		},
	)

/** `useNotificationUnreadCountsByChannel`. */
export const unreadCountsStream = <M>(
	memberId: OrganizationMemberId,
	toMessage: (counts: Array<UnreadCount>) => M,
) =>
	liveQueryStream<{ targetedResourceType: string | null; targetedResourceId: ChannelId | null }, M>(
		(q) =>
			q
				.from({ notification: notificationCollection })
				.where(({ notification }) =>
					and(eq(notification.memberId, memberId), isNull(notification.readAt)),
				),
		(rows) => {
			const counts = new Map<ChannelId, number>()
			for (const row of rows) {
				if (row.targetedResourceType !== "channel" || !row.targetedResourceId) continue
				counts.set(row.targetedResourceId, (counts.get(row.targetedResourceId) ?? 0) + 1)
			}
			return toMessage([...counts].map(([channelId, count]) => ({ channelId, count })))
		},
	)

/** `useSharedChannels`, first query: active Connect mounts. */
export const connectMountsStream = <M>(toMessage: (mounts: Array<ConnectMount>) => M) =>
	liveQueryStream<
		{
			channelId: ChannelId
			conversationId: ConnectConversationId
			organizationId: OrganizationId
			isActive: boolean
			deletedAt: Date | null
		},
		M
	>(
		(q) =>
			q
				.from({ ccc: connectConversationChannelCollection })
				.where(({ ccc }) => eq(ccc.isActive, true))
				.select(({ ccc }) => ({
					channelId: ccc.channelId,
					conversationId: ccc.conversationId,
					organizationId: ccc.organizationId,
					isActive: ccc.isActive,
					deletedAt: ccc.deletedAt,
				})),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					channelId: row.channelId,
					conversationId: row.conversationId,
					organizationId: row.organizationId,
					isActive: row.isActive,
					isDeleted: row.deletedAt !== null,
				})),
			),
	)

/** `useSharedChannels`, second query: every organization's display fields. */
export const organizationsStream = <M>(toMessage: (orgs: Array<PartnerOrg>) => M) =>
	liveQueryStream<{ id: OrganizationId; name: string; logoUrl: string | null }, M>(
		(q) =>
			q.from({ org: organizationCollection }).select(({ org }) => ({
				id: org.id,
				name: org.name,
				slug: org.slug,
				logoUrl: org.logoUrl,
			})),
		(rows) =>
			toMessage(rows.map((row) => ({ id: row.id, name: row.name, logoUrl: row.logoUrl ?? null }))),
	)
