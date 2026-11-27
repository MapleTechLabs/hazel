/**
 * The channel header's live queries over the app's `ClientData` (today's `lookup-data.ts` and
 * `queries.ts` streams the Foldkit channel page ran for its header).
 */
import type { ChannelMember } from "@hazel/domain/models"
import type { ChannelId, ChannelMemberId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import type { Stream } from "effect"
import type { ClientData } from "@hazel/client-data"
import { withData } from "../../app/live"
import { makeChannelData } from "../../customers/data/channels"
import { type HeaderChannel, type HeaderMember, inheritedLevelOf, type NotificationLevel } from "./model"

const msOf = (value: Date | string | null | undefined) =>
	value === null || value === undefined ? null : new Date(value).getTime()

interface ChannelRow {
	readonly id: ChannelId
	readonly name: string
	readonly icon?: string | null
	readonly type: string
	readonly parentChannelId?: ChannelId | null
}

const toChannel = (row: ChannelRow): HeaderChannel => ({
	id: row.id,
	name: row.name,
	icon: row.icon ?? null,
	type: row.type,
	parentChannelId: row.parentChannelId ?? null,
})

/** One channel by id (the header's, or a thread's parent); null until it syncs or once deleted. */
export const channelStream = <M>(
	channelId: ChannelId,
	to: (channel: HeaderChannel | null) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<ChannelRow, M>(
			(q) =>
				q
					.from({ channel: data.collections.channelCollection })
					.where(({ channel }) => and(eq(channel.id, channelId), isNull(channel.deletedAt))),
			(rows) => to(rows[0] === undefined ? null : toChannel(rows[0])),
		),
	)

interface MemberRow {
	readonly member: {
		readonly id: ChannelMemberId
		readonly userId: UserId
		readonly isHidden: boolean
		readonly isMuted: boolean
		readonly mutedUntil?: Date | string | null
		readonly notificationLevel?: ChannelMember.NotificationLevel | null
	}
	readonly user?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
		readonly userType?: string
		readonly email?: string | null
	}
	readonly bot?: { readonly name: string }
}

/** Chat sync's shadow users are machine users too, but people on Slack or Discord. */
const isShadow = (email: string | null | undefined) =>
	email?.startsWith("discord-user-") === true || email?.startsWith("slack-user-") === true

/** The channel's members, oldest first, with their names (a bot's own name) and pictures. */
export const membersStream = <M>(
	channelId: ChannelId,
	to: (members: Array<HeaderMember>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<MemberRow, M>(
			(q) =>
				q
					.from({ member: data.collections.channelMemberCollection })
					.leftJoin({ user: data.collections.userCollection }, ({ member, user }) =>
						eq(user.id, member.userId),
					)
					.leftJoin({ bot: data.collections.botCollection }, ({ member, bot }) =>
						eq(bot.userId, member.userId),
					)
					.where(({ member }) => eq(member.channelId, channelId))
					.orderBy(({ member }) => member.createdAt, "asc"),
			(rows) =>
				to(
					rows.map(({ member, user, bot }) => {
						const isBot = user?.userType === "machine" && !isShadow(user.email)
						const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim()
						return {
							id: member.id,
							userId: member.userId,
							isHidden: member.isHidden,
							isMuted: member.isMuted,
							mutedUntilMs: msOf(member.mutedUntil),
							notificationLevel: member.notificationLevel ?? null,
							displayName: isBot && bot !== undefined ? bot.name : name,
							avatarUrl: user?.avatarUrl ?? null,
							isBot,
						}
					}),
				),
		),
	)

/** `inheritedLevelStream`: the channel's "Default" for the user, from their own overrides. */
export const inheritedLevelStream = <M>(
	channelId: ChannelId,
	to: (level: NotificationLevel) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<
			{
				type: string
				sectionLevel?: NotificationLevel | null
				organizationLevel?: NotificationLevel | null
			},
			M
		>(
			(q) =>
				q
					.from({ channel: data.collections.channelCollection })
					.leftJoin({ section: data.collections.notificationOverrideCollection }, ({ channel, section }) =>
						eq(section.scopeId, channel.sectionId),
					)
					.leftJoin({ org: data.collections.notificationOverrideCollection }, ({ channel, org }) =>
						eq(org.scopeId, channel.organizationId),
					)
					.where(({ channel }) => eq(channel.id, channelId))
					.select(({ channel, section, org }) => ({
						type: channel.type,
						sectionLevel: section?.level,
						organizationLevel: org?.level,
					})),
			(rows) => {
				const row = rows[0]
				return to(
					inheritedLevelOf(row?.type ?? "public", {
						sectionLevel: row?.sectionLevel ?? null,
						organizationLevel: row?.organizationLevel ?? null,
					}),
				)
			},
		),
	)

/** The linked customer's row (`channel_customers`), from the org source. */
export const customerStream = <M>(
	channelId: ChannelId,
	to: (customer: ReturnType<typeof toCustomer>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		makeChannelData(data).channelCustomerStream(channelId, (row) => to(row === null ? null : toCustomer(row))),
	)

type CustomerRow = Parameters<Parameters<ReturnType<typeof makeChannelData>["channelCustomerStream"]>[1]>[0]

/** The row without its timestamp, as the card reads it. */
const toCustomer = (row: CustomerRow) => {
	if (row === null) return null
	const { updatedAt: _updatedAt, company, accountLogoUrl, ...rest } = row
	return { ...rest, accountLogoUrl: accountLogoUrl ?? null, company: company ?? null }
}

/** The channel's live chat sync provider (`syncedChannelsStream`), `none` without one. */
export const syncStream = <M>(
	channelId: ChannelId,
	to: (provider: "none" | "slack" | "discord") => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<{ provider: string }, M>(
			(q) =>
				q
					.from({ link: data.collections.chatSyncChannelLinkCollection })
					.innerJoin(
						{ connection: data.collections.chatSyncConnectionCollection },
						({ link, connection }) => eq(link.syncConnectionId, connection.id),
					)
					.where(({ link, connection }) =>
						and(
							eq(link.hazelChannelId, channelId),
							eq(link.isActive, true),
							isNull(link.deletedAt),
							eq(connection.status, "active"),
							isNull(connection.deletedAt),
						),
					)
					.select(({ connection }) => ({ provider: connection.provider })),
			(rows) => {
				const provider = rows[0]?.provider
				return to(provider === "slack" || provider === "discord" ? provider : "none")
			},
		),
	)

/** The newest presence row of one user, as the avatar's presence. */
export const presenceStream = <M>(
	userId: UserId,
	to: (status: "online" | "away" | "busy" | "offline") => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<{ status?: string | null }, M>(
			(q) =>
				q
					.from({ presence: data.collections.userPresenceStatusCollection })
					.where(({ presence }) => eq(presence.userId, userId))
					.orderBy(({ presence }) => presence.updatedAt, "desc"),
			(rows) => {
				const status = rows[0]?.status
				return to(
					status === "online" || status === "away" || status === "busy"
						? status
						: status === "dnd"
							? "busy"
							: "offline",
				)
			},
		),
	)

/** A user's display name (the customer card's owner); null without the user. */
export const ownerNameStream = <M>(
	userId: UserId,
	to: (name: string | null) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<{ firstName: string; lastName: string; email?: string | null }, M>(
			(q) =>
				q
					.from({ user: data.collections.userCollection })
					.where(({ user }) => eq(user.id, userId)),
			(rows) => {
				const row = rows[0]
				return to(
					row === undefined ? null : `${row.firstName} ${row.lastName}`.trim() || (row.email ?? null),
				)
			},
		),
	)
