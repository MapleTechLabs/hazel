import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, inArray, not, or } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { channelCollection, channelMemberCollection, userPresenceStatusCollection } from "~/db/collections"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { liveQueryStream } from "../../data/live-query"
import type { Shared } from "../../page/contract"
import { channelMemberWithUserCollection } from "../data"
import { readRecentChannelIds } from "./commands"
import { searchSubscriptions } from "./search-subscription"
import { Message } from "./message"
import type { ChannelSummary, DmChannel, Model } from "./model"

/** The palette pages' `useLiveQuery` calls, open only while their page shows. */

export interface Input {
	readonly model: Model
	readonly shared: Shared
}

interface ChannelRow {
	readonly id: ChannelId
	readonly name: string
	readonly type: string
	readonly icon?: string | null
}

const toSummary = (channel: ChannelRow): ChannelSummary => ({
	id: channel.id,
	name: channel.name,
	type: channel.type,
	icon: channel.icon ?? null,
})

interface DmRow {
	readonly channel: ChannelRow
	readonly member: {
		readonly userId: UserId
		readonly user: { readonly firstName: string; readonly lastName: string; readonly avatarUrl?: string | null }
	}
}

/** `dmChannels`: group rows by channel, keep the user's own channels, list the other members. */
const toDmChannels = (rows: ReadonlyArray<DmRow>, userId: UserId): Array<DmChannel> => {
	const byChannel = new Map<string, { channel: ChannelRow; members: Array<DmRow["member"]> }>()
	for (const row of rows) {
		const entry = byChannel.get(row.channel.id) ?? { channel: row.channel, members: [] }
		entry.members.push(row.member)
		byChannel.set(row.channel.id, entry)
	}
	return [...byChannel.values()]
		.filter(({ members }) => members.some((member) => member.userId === userId))
		.map(({ channel, members }) => ({
			id: channel.id,
			type: channel.type,
			otherMembers: members
				.filter((member) => member.userId !== userId)
				.map((member) => ({
					userId: member.userId,
					firstName: member.user.firstName,
					lastName: member.user.lastName,
					avatarUrl: member.user.avatarUrl ?? null,
				})),
		}))
}

const Context = { organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) }
const contextOf = (input: Input, page: Model["page"]["_tag"]) =>
	input.model.isOpen && input.model.page._tag === page
		? { organizationId: input.shared.organization?.id ?? null, userId: input.shared.currentUser?.id ?? null }
		: { organizationId: null, userId: null }

const pageSubscriptions = Subscription.make<Input, Message>()((entry) => ({
	homeChannels: entry(Context, {
		modelToDependencies: (input) => contextOf(input, "Home"),
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: liveQueryStream<{ channel: ChannelRow }, Message>(
						(q) =>
							q
								.from({ channel: channelCollection })
								.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
									eq(member.channelId, channel.id),
								)
								.where((t) =>
									and(
										eq(t.channel.organizationId, organizationId),
										or(eq(t.channel.type, "public"), eq(t.channel.type, "private")),
										eq(t.member.userId, userId),
										eq(t.member.isHidden, false),
									),
								)
								.orderBy(({ channel }) => channel.name, "asc"),
						(rows) => Message.UpdatedChannels({ channels: rows.map((row) => toSummary(row.channel)) }),
					),
	}),
	homeDmChannels: entry(Context, {
		modelToDependencies: (input) => contextOf(input, "Home"),
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: liveQueryStream<DmRow, Message>(
						(q) =>
							q
								.from({ channel: channelCollection })
								.innerJoin({ member: channelMemberWithUserCollection }, ({ channel, member }) =>
									eq(member.channelId, channel.id),
								)
								.where((t) =>
									and(
										eq(t.channel.organizationId, organizationId),
										or(eq(t.channel.type, "single"), eq(t.channel.type, "direct")),
									),
								),
						(rows) => Message.UpdatedDmChannels({ dmChannels: toDmChannels(rows, userId) }),
					),
	}),
	recentChannelIds: entry(
		{ isOpen: Schema.Boolean },
		{
			modelToDependencies: (input) => ({ isOpen: input.model.isOpen && input.model.page._tag === "Home" }),
			dependenciesToStream: ({ isOpen }) =>
				isOpen
					? Stream.fromEffect(readRecentChannelIds).pipe(
							Stream.map((channelIds) => Message.UpdatedRecentChannelIds({ channelIds })),
						)
					: Stream.empty,
		},
	),
	recentChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId), channelIds: Schema.Array(ChannelId) },
		{
			modelToDependencies: (input) => ({
				organizationId: contextOf(input, "Home").organizationId,
				channelIds: input.model.recentChannelIds,
			}),
			dependenciesToStream: ({ organizationId, channelIds }) =>
				organizationId === null || channelIds.length === 0
					? Stream.empty
					: liveQueryStream<ChannelRow, Message>(
							(q) =>
								q
									.from({ channel: channelCollection })
									.where(({ channel }) =>
										and(eq(channel.organizationId, organizationId), inArray(channel.id, [...channelIds])),
									)
									.select(({ channel }) => ({ ...channel })),
							(rows) => Message.UpdatedRecentChannels({ channels: rows.map(toSummary) }),
						),
		},
	),
	presence: entry(
		{ userId: Schema.NullOr(UserId), nowMs: Schema.Number },
		{
			modelToDependencies: (input) => ({ userId: contextOf(input, "Status").userId, nowMs: input.shared.nowMs }),
			dependenciesToStream: ({ userId, nowMs }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<{ status: string | null; lastSeenAt: Date | null }, Message>(
							(q) =>
								q
									.from({ presence: userPresenceStatusCollection })
									.where(({ presence }) => eq(presence.userId, userId))
									.orderBy(({ presence }) => presence.updatedAt, "desc")
									.findOne(),
							(rows) => {
								const row = rows[0]
								const status = getEffectivePresenceStatus(
									row ? { status: row.status, lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null } : null,
									nowMs,
								)
								// `usePresence().status` never shows the local user as offline.
								return Message.UpdatedPresenceStatus({ status: status === "offline" ? "online" : status })
							},
						),
		},
	),
	memberChannelIds: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (input) => ({ userId: contextOf(input, "JoinChannel").userId }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<{ channelId: ChannelId }, Message>(
							(q) =>
								q
									.from({ m: channelMemberCollection })
									.where(({ m }) => eq(m.userId, userId))
									.select(({ m }) => ({ channelId: m.channelId })),
							(rows) => Message.UpdatedMemberChannelIds({ channelIds: rows.map((row) => row.channelId) }),
						),
		},
	),
	unjoinedChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId), channelIds: Schema.NullOr(Schema.Array(ChannelId)) },
		{
			modelToDependencies: (input) => ({
				organizationId: contextOf(input, "JoinChannel").organizationId,
				channelIds: input.model.memberChannelIds,
			}),
			dependenciesToStream: ({ organizationId, channelIds }) =>
				organizationId === null || channelIds === null
					? Stream.empty
					: liveQueryStream<ChannelRow, Message>(
							(q) => {
								const base = q
									.from({ channel: channelCollection })
									.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
									.where(({ channel }) => eq(channel.organizationId, organizationId))
								return (
									channelIds.length === 0
										? base
										: base.where(({ channel }) => not(inArray(channel.id, [...channelIds])))
								).select(({ channel }) => ({ ...channel }))
							},
							(rows) => Message.UpdatedUnjoinedChannels({ channels: rows.map(toSummary) }),
						),
		},
	),
}))

/** Keys are prefixed: Subscription keys share one namespace across the root aggregate. */
export const subscriptions = Object.fromEntries(
	Object.entries({ ...pageSubscriptions, ...searchSubscriptions }).map(([key, entry]) => [`commandPalette.${key}`, entry]),
)
