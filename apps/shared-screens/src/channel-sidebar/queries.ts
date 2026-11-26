/**
 * The sidebar's live queries over `ClientData`, with today's filters (`channels-sidebar/data.ts`,
 * `people-data.ts`). Each returns a stream of one message per change of its rows.
 */
import { ClientData } from "@hazel/client-data"
import type { ChannelId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, inArray, isNull, not, or } from "@tanstack/db"
import { Effect, Stream } from "effect"
import type {
	Customer,
	Discoverable,
	Entry,
	Me,
	NotificationLevel,
	Org,
	Person,
	Presence,
	ScopeSetting,
	Section,
	Synced,
	Thread,
	Unread,
} from "./model"

type Data = ClientData["Service"]

const withData = <A>(make: (data: Data) => Stream.Stream<A>): Stream.Stream<A, never, ClientData> =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			make,
		),
	)

const msOf = (date: Date | string | null | undefined) => (date ? new Date(date).getTime() : null)

export const sectionsStream = <M>(organizationId: OrganizationId, to: (rows: Array<Section>) => M) =>
	withData((data) =>
		data.liveQueryStream<{ id: ChannelSectionId; name: string }, M>(
			(q) =>
				q
					.from({ section: data.collections.channelSectionCollection })
					.where(({ section }) =>
						and(eq(section.organizationId, organizationId), isNull(section.deletedAt)),
					)
					.orderBy(({ section }) => section.order, "asc"),
			(rows) => to(rows.map((row) => ({ id: row.id, name: row.name }))),
		),
	)

interface MembershipRow {
	readonly channel: {
		readonly id: ChannelId
		readonly name: string
		readonly type: string
		readonly icon?: string | null
		readonly sectionId?: ChannelSectionId | null
		readonly parentChannelId?: ChannelId | null
		readonly createdAt: Date
	}
	readonly member: {
		readonly id: Entry["memberId"]
		readonly isMuted: boolean
		readonly mutedUntil?: Date | null
		readonly notificationLevel?: NotificationLevel | null
		readonly isFavorite: boolean
		readonly notificationCount: number
	}
}

/** Every visible membership in the org, oldest channel first: channels, DMs and threads in one query. */
export const membershipsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	to: (entries: Array<Entry>, threads: Array<Thread>) => M,
) =>
	withData((data) =>
		data.liveQueryStream<MembershipRow, M>(
			(q) =>
				q
					.from({ channel: data.collections.channelCollection })
					.innerJoin({ member: data.collections.channelMemberCollection }, ({ channel, member }) =>
						eq(member.channelId, channel.id),
					)
					.where(({ channel, member }) =>
						and(
							eq(channel.organizationId, organizationId),
							isNull(channel.deletedAt),
							eq(member.userId, userId),
							eq(member.isHidden, false),
						),
					)
					.orderBy(({ channel }) => channel.createdAt, "asc"),
			(rows) => {
				const entries: Array<Entry> = []
				const threads: Array<Thread> = []
				for (const { channel, member } of rows) {
					if (channel.type === "thread") {
						if (channel.parentChannelId)
							threads.push({
								id: channel.id,
								name: channel.name,
								parentChannelId: channel.parentChannelId,
								createdAtMs: msOf(channel.createdAt) ?? 0,
								notificationCount: member.notificationCount,
							})
						continue
					}
					entries.push({
						id: channel.id,
						name: channel.name,
						type: channel.type,
						icon: channel.icon ?? null,
						sectionId: channel.sectionId ?? null,
						memberId: member.id,
						isMuted: member.isMuted,
						mutedUntilMs: msOf(member.mutedUntil),
						notificationLevel: member.notificationLevel ?? null,
						isFavorite: member.isFavorite,
						notificationCount: member.notificationCount,
					})
				}
				return to(entries, threads)
			},
		),
	)

/** Each DM's members other than the user, by channel (`useChannelWithCurrentUser`). */
export const dmPeopleStream = <M>(
	userId: UserId,
	dmIds: ReadonlyArray<ChannelId>,
	to: (people: Record<string, Array<Person>>) => M,
) =>
	withData((data) =>
		data.liveQueryStream<
			{
				member: { channelId: ChannelId; userId: UserId }
				user: { firstName: string; lastName: string; avatarUrl?: string | null }
			},
			M
		>(
			(q) =>
				q
					.from({ member: data.collections.channelMemberCollection })
					.innerJoin({ user: data.collections.userCollection }, ({ member, user }) =>
						eq(user.id, member.userId),
					)
					.where(({ member }) =>
						and(inArray(member.channelId, [...dmIds]), not(eq(member.userId, userId))),
					),
			(rows) => {
				const people: Record<string, Array<Person>> = {}
				for (const { member, user } of rows)
					(people[member.channelId] ??= []).push({
						userId: member.userId,
						firstName: user.firstName,
						lastName: user.lastName,
						avatarUrl: user.avatarUrl ?? null,
					})
				return to(people)
			},
		),
	)

/** Newest presence row per user (`presenceStream`). */
export const presenceStream = <M>(userIds: ReadonlyArray<UserId>, to: (rows: Array<Presence>) => M) =>
	withData((data) =>
		data.liveQueryStream<{ userId: UserId; status?: string | null; statusEmoji?: string | null }, M>(
			(q) =>
				q
					.from({ presence: data.collections.userPresenceStatusCollection })
					.where(({ presence }) => inArray(presence.userId, [...userIds]))
					.orderBy(({ presence }) => presence.updatedAt, "desc"),
			(rows) => {
				const seen = new Set<UserId>()
				return to(
					rows
						.filter((row) => !seen.has(row.userId) && seen.add(row.userId))
						.map((row) => ({
							userId: row.userId,
							status: row.status ?? null,
							statusEmoji: row.statusEmoji ?? null,
						})),
				)
			},
		),
	)

/** The user's org membership role and id (`membershipStream`). */
export const roleStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	to: (role: string | null, memberId: string | null) => M,
) =>
	withData((data) =>
		data.liveQueryStream<{ id: string; role: string }, M>(
			(q) =>
				q
					.from({ member: data.collections.organizationMemberCollection })
					.where(({ member }) =>
						and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
					),
			(rows) => to(rows[0]?.role ?? null, rows[0]?.id ?? null),
		),
	)

/** Unread notifications per targeted channel (`useNotificationUnreadCountsByChannel`). */
export const unreadCountsStream = <M>(memberId: string, to: (counts: Record<string, number>) => M) =>
	withData((data) =>
		data.liveQueryStream<
			{ targetedResourceType: string | null; targetedResourceId: ChannelId | null },
			M
		>(
			(q) =>
				q
					.from({ notification: data.collections.notificationCollection })
					.where(({ notification }) =>
						and(eq(notification.memberId, memberId), isNull(notification.readAt)),
					),
			(rows) => {
				const counts: Record<string, number> = {}
				for (const row of rows)
					if (row.targetedResourceType === "channel" && row.targetedResourceId)
						counts[row.targetedResourceId] = (counts[row.targetedResourceId] ?? 0) + 1
				return to(counts)
			},
		),
	)

interface UnreadRow {
	readonly channelId: ChannelId
	readonly isMuted: boolean
	readonly mutedUntil: Date | null
	readonly joinedAt: Date
	readonly lastReadAt: Date | null | undefined
	readonly readStateSince: Date | null
	readonly lastMessageAt: Date
	readonly lastMessageAuthorId: UserId
	readonly type: string
	readonly sectionMuted: boolean | undefined
	readonly sectionMutedUntil: Date | null | undefined
	readonly orgMuted: boolean | undefined
	readonly orgMutedUntil: Date | null | undefined
}

/** `unreadMuteEnd` (`lib/unread.ts`): unread, and when its latest timed mute ends; none when read. */
const unreadOf = (row: UnreadRow, userId: UserId): Unread | undefined => {
	const mutes = [
		{ isMuted: row.isMuted, until: row.mutedUntil },
		...(row.type === "direct" || row.type === "single"
			? []
			: [
					{ isMuted: row.sectionMuted === true, until: row.sectionMutedUntil ?? null },
					{ isMuted: row.orgMuted === true, until: row.orgMutedUntil ?? null },
				]),
	]
	if (mutes.some((mute) => mute.isMuted)) return undefined
	const readUpTo =
		row.lastReadAt != null
			? new Date(row.lastReadAt).getTime()
			: Math.max(new Date(row.joinedAt).getTime(), msOf(row.readStateSince) ?? 0)
	const isUnread = row.lastMessageAuthorId !== userId && new Date(row.lastMessageAt).getTime() > readUpTo
	if (!isUnread) return undefined
	const untils = mutes.flatMap((mute) => (mute.until ? [new Date(mute.until).getTime()] : []))
	return { channelId: row.channelId, mutedUntilMs: untils.length === 0 ? null : Math.max(...untils) }
}

/** The channels with messages the user has not read (`unreadChannelsStream`). */
export const unreadStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	to: (rows: Array<Unread>) => M,
) =>
	withData((data) => {
		const c = data.collections
		return data.liveQueryStream<UnreadRow, M>(
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
					.leftJoin({ read: c.channelReadStateCollection }, ({ member, read }) =>
						eq(read.channelId, member.channelId),
					)
					.leftJoin({ section: c.notificationOverrideCollection }, ({ channel, section }) =>
						eq(section.scopeId, channel.sectionId),
					)
					.leftJoin({ org: c.notificationOverrideCollection }, ({ activity, org }) =>
						eq(org.scopeId, activity.organizationId),
					)
					.where(({ activity, member }) =>
						and(
							eq(activity.organizationId, organizationId),
							eq(member.userId, userId),
							isNull(member.deletedAt),
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
				to(
					rows
						.flatMap((row) => {
							const unread = unreadOf(row, userId)
							return unread === undefined ? [] : [unread]
						})
						.sort((a, b) => a.channelId.localeCompare(b.channelId)),
				),
		)
	})

/** The user's notification settings for the org's sections and the org itself. */
export const scopeSettingsStream = <M>(
	organizationId: OrganizationId,
	to: (rows: Array<ScopeSetting>) => M,
) =>
	withData((data) =>
		data.liveQueryStream<
			{
				scope: string
				scopeId: string
				isMuted: boolean
				mutedUntil: Date | null
				level: NotificationLevel | null
			},
			M
		>(
			(q) =>
				q
					.from({ override: data.collections.notificationOverrideCollection })
					.where(({ override }) =>
						and(
							eq(override.organizationId, organizationId),
							or(eq(override.scope, "section"), eq(override.scope, "organization")),
						),
					)
					.select(({ override }) => ({
						scope: override.scope,
						scopeId: override.scopeId,
						isMuted: override.isMuted,
						mutedUntil: override.mutedUntil,
						level: override.level,
					})),
			(rows) =>
				to(
					rows
						.map((row) => ({
							sectionId: row.scope === "section" ? (row.scopeId as ChannelSectionId) : null,
							isMuted: row.isMuted,
							mutedUntilMs: msOf(row.mutedUntil),
							notificationLevel: row.level ?? null,
						}))
						.sort((a, b) => (a.sectionId ?? "").localeCompare(b.sectionId ?? "")),
				),
		),
	)

export const customersStream = <M>(organizationId: OrganizationId, to: (rows: Array<Customer>) => M) =>
	withData((data) =>
		data.liveQueryStream<
			{ channelId: ChannelId; accountName: string; accountLogoUrl?: string | null },
			M
		>(
			(q) =>
				q
					.from({ customer: data.collections.channelCustomerCollection })
					.where(({ customer }) => eq(customer.organizationId, organizationId)),
			(rows) =>
				to(
					rows.map((row) => ({
						channelId: row.channelId,
						accountName: row.accountName,
						accountLogoUrl: row.accountLogoUrl ?? null,
					})),
				),
		),
	)

/** Channels with an active chat sync link on a live connection (`syncedChannelsStream`). */
export const syncedStream = <M>(to: (rows: Array<Synced>) => M) =>
	withData((data) =>
		data.liveQueryStream<{ channelId: ChannelId; provider: string }, M>(
			(q) =>
				q
					.from({ link: data.collections.chatSyncChannelLinkCollection })
					.innerJoin(
						{ connection: data.collections.chatSyncConnectionCollection },
						({ link, connection }) => eq(link.syncConnectionId, connection.id),
					)
					.where(({ link, connection }) =>
						and(
							eq(link.isActive, true),
							isNull(link.deletedAt),
							eq(connection.status, "active"),
							isNull(connection.deletedAt),
						),
					)
					.select(({ link, connection }) => ({
						channelId: link.hazelChannelId,
						provider: connection.provider,
					})),
			(rows) =>
				to(
					rows.flatMap((row) =>
						row.provider === "slack" || row.provider === "discord"
							? [{ channelId: row.channelId, provider: row.provider }]
							: [],
					),
				),
		),
	)

/** Public top-level channels the user has not joined (`DiscoverableChannels`), and the joined count. */
export const discoverStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	to: (rows: Array<Discoverable>, memberCount: number) => M,
) =>
	withData((data) => {
		const c = data.collections
		return Stream.zipLatest(
			data.liveQueryStream<
				{ id: ChannelId; name: string; type: string; icon?: string | null },
				ReadonlyArray<{ id: ChannelId; name: string; type: string; icon?: string | null }>
			>(
				(q) =>
					q
						.from({ channel: c.channelCollection })
						.where(({ channel }) =>
							and(
								eq(channel.organizationId, organizationId),
								or(eq(channel.type, "public"), eq(channel.type, "private")),
								isNull(channel.parentChannelId),
							),
						)
						.orderBy(({ channel }) => channel.createdAt, "asc"),
				(rows) => rows,
			),
			data.liveQueryStream<{ channelId: ChannelId }, ReadonlySet<string>>(
				(q) =>
					q
						.from({ member: c.channelMemberCollection })
						.where(({ member }) => eq(member.userId, userId))
						.select(({ member }) => ({ channelId: member.channelId })),
				(rows) => new Set(rows.map((row) => row.channelId)),
			),
		).pipe(
			Stream.map(([channels, joined]) =>
				to(
					channels
						.filter((channel) => channel.type === "public" && !joined.has(channel.id))
						.map((channel) => ({
							id: channel.id,
							name: channel.name,
							icon: channel.icon ?? null,
						})),
					channels.filter((channel) => joined.has(channel.id)).length,
				),
			),
		)
	})

/** The organizations the user belongs to, and the signed-in user (the header and account card). */
export const chromeStream = <M>(userId: UserId, to: (orgs: Array<Org>, me: Me | null) => M) =>
	withData((data) => {
		const c = data.collections
		return Stream.zipLatest(
			data.liveQueryStream<{ id: Org["id"]; name: string; logoUrl?: string | null }, Array<Org>>(
				(q) =>
					q
						.from({ org: c.organizationCollection })
						.innerJoin({ member: c.organizationMemberCollection }, ({ org, member }) =>
							eq(member.organizationId, org.id),
						)
						.where(({ member, org }) => and(eq(member.userId, userId), isNull(org.deletedAt)))
						.select(({ org }) => ({ id: org.id, name: org.name, logoUrl: org.logoUrl })),
				(rows) => rows.map((row) => ({ id: row.id, name: row.name, logoUrl: row.logoUrl ?? null })),
			),
			data.liveQueryStream<
				{ firstName: string; lastName: string; email: string; avatarUrl?: string | null },
				Me | null
			>(
				(q) => q.from({ user: c.userCollection }).where(({ user }) => eq(user.id, userId)),
				(rows) =>
					rows[0] === undefined
						? null
						: {
								firstName: rows[0].firstName,
								lastName: rows[0].lastName,
								email: rows[0].email,
								avatarUrl: rows[0].avatarUrl ?? null,
							},
			),
		).pipe(Stream.map(([orgs, me]) => to(orgs, me)))
	})
