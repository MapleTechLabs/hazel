// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat index's data and rows, shared by `/:org/chat` and `/:org/chat/dms` (today's
 * `web-foldkit/src/page/chat-index/{group,cards}.ts`): the user's visible channels split by type,
 * and one card per channel or DM.
 */
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { eq, inArray } from "@tanstack/db"
import { Subscription } from "@effect/ui"
import { Schema, Stream } from "effect"
import type { ClientData } from "@hazel/client-data"
import { withData } from "../../app/live"
import type { Session } from "../../app/session"
import { customersStream, syncedStream } from "../../channel-sidebar/queries"
import { Customer, Synced } from "../../channel-sidebar/model"
import { presenceOf } from "../../dms/Dms"
import { fullName, initialsOf } from "../../dms/format"

export const Member = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type Member = typeof Member.Type

export const ChannelSummary = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
	isMuted: Schema.Boolean,
	isFavorite: Schema.Boolean,
	notificationCount: Schema.Finite,
	/** Every member, in query order (DM cards name them). */
	members: Schema.Array(Member),
})
export type ChannelSummary = typeof ChannelSummary.Type

export const ChannelGroups = Schema.Struct({
	publicChannels: Schema.Array(ChannelSummary),
	privateChannels: Schema.Array(ChannelSummary),
	dmChannels: Schema.Array(ChannelSummary),
})
export type ChannelGroups = typeof ChannelGroups.Type

export const EMPTY_GROUPS: ChannelGroups = { publicChannels: [], privateChannels: [], dmChannels: [] }

/** A channel's marks on its icon: a customer's logo, the chat sync provider (the sidebar's queries). */
export const ChannelMarks = Schema.Struct({ customers: Schema.Array(Customer), synced: Schema.Array(Synced) })
export type ChannelMarks = typeof ChannelMarks.Type

export const NO_MARKS: ChannelMarks = { customers: [], synced: [] }

/** Presence of a one-to-one DM's partner, as the avatar draws it. */
export const Presence = Schema.Literals(["online", "away", "busy", "offline"])
export type Presence = typeof Presence.Type

interface ChannelRow {
	readonly channel: {
		readonly id: ChannelId
		readonly name: string
		readonly type: string
		readonly icon?: string | null
	}
	readonly member: {
		readonly userId: UserId
		readonly isHidden: boolean
		readonly isMuted: boolean
		readonly isFavorite: boolean
		readonly notificationCount?: number | null
	}
	readonly user: {
		readonly id: UserId
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

/** Today's `useMemo`: rows by channel, the user's visible channels only, split by type. */
export const groupChannels = (rows: ReadonlyArray<ChannelRow>, userId: UserId): ChannelGroups => {
	const byChannel = new Map<
		string,
		{ channel: ChannelRow["channel"]; members: Array<Member>; mine?: ChannelRow["member"] }
	>()
	for (const row of rows) {
		const entry = byChannel.get(row.channel.id) ?? { channel: row.channel, members: [] }
		entry.members.push({
			userId: row.user.id,
			firstName: row.user.firstName,
			lastName: row.user.lastName,
			avatarUrl: row.user.avatarUrl ?? null,
		})
		if (row.member.userId === userId) entry.mine = row.member
		byChannel.set(row.channel.id, entry)
	}
	const groups = {
		publicChannels: [] as Array<ChannelSummary>,
		privateChannels: [] as Array<ChannelSummary>,
		dmChannels: [] as Array<ChannelSummary>,
	}
	for (const { channel, members, mine } of byChannel.values()) {
		if (!mine || mine.isHidden) continue
		const summary: ChannelSummary = {
			id: channel.id,
			name: channel.name,
			type: channel.type,
			icon: channel.icon ?? null,
			isMuted: mine.isMuted,
			isFavorite: mine.isFavorite,
			notificationCount: mine.notificationCount || 0,
			members,
		}
		if (channel.type === "public") groups.publicChannels.push(summary)
		else if (channel.type === "private") groups.privateChannels.push(summary)
		else if (channel.type === "direct" || channel.type === "single") groups.dmChannels.push(summary)
	}
	return groups
}

/** The org's channels with their members, oldest first (`routes/_app/$orgSlug/chat/index.tsx`). */
export const channelsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId,
	to: (groups: ChannelGroups) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<ChannelRow, M>(
			(q) =>
				q
					.from({ channel: data.collections.channelCollection })
					.innerJoin({ member: data.collections.channelMemberCollection }, ({ channel, member }) =>
						eq(member.channelId, channel.id),
					)
					.innerJoin({ user: data.collections.userCollection }, ({ member, user }) =>
						eq(user.id, member.userId),
					)
					.where(({ channel }) => eq(channel.organizationId, organizationId))
					.orderBy(({ channel }) => channel.createdAt, "asc"),
			(rows) => to(groupChannels(rows, userId)),
		),
	)

/** The newest presence row of each user (`useUserPresence`). */
export const presenceStream = <M>(
	userIds: ReadonlyArray<UserId>,
	to: (presence: Record<string, Presence>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<{ userId: UserId; status?: string | null }, M>(
			(q) =>
				q
					.from({ presence: data.collections.userPresenceStatusCollection })
					.where(({ presence }) => inArray(presence.userId, [...userIds]))
					.orderBy(({ presence }) => presence.updatedAt, "desc"),
			(rows) => {
				const presence: Record<string, Presence> = {}
				for (const row of rows) presence[row.userId] ??= presenceOf(row.status)
				return to(presence)
			},
		),
	)

export const otherMembers = (channel: ChannelSummary, userId: UserId) =>
	channel.members.filter((member) => member.userId !== userId)

/** One-to-one DM partners, whose presence the cards show. */
export const partnerIdsOf = (groups: ChannelGroups, userId: UserId): ReadonlyArray<UserId> =>
	groups.dmChannels.flatMap((channel) => {
		const others = otherMembers(channel, userId)
		return channel.type === "single" && others.length === 1 && others[0] ? [others[0].userId] : []
	})

/** Today's order of labels: any status but offline reads "Active now", so the others never show. */
const statusText = (presence: Presence | undefined) =>
	presence !== undefined && presence !== "offline" ? "Active now" : "Offline"

const channelHref = (orgSlug: string, channel: ChannelSummary) => `/${orgSlug}/chat/${channel.id}`

/** A public or private channel: its icon with marks, name, members, favorite and unread count. */
export const channelCard = <Msg>(
	h: Hazel.H<Msg>,
	orgSlug: string,
	channel: ChannelSummary,
	marks: ChannelMarks,
) => {
	const customer = marks.customers.find((row) => row.channelId === channel.id)
	const members = channel.members.length
	const sync = marks.synced.find((row) => row.channelId === channel.id)?.provider ?? "none"
	return (
		h.item
			.key(channel.id)
			.title(channel.name)
			// HAZEL-GAP(p4-item-subtitle-icons): today's meta line is a users glyph and the bare count, and a muted glyph.
			.subtitle(`${members} member${members === 1 ? "" : "s"}${channel.isMuted ? " · Muted" : ""}`)
			.leadingSize("large")
			// Today's neutral 40pt tile around every channel's icon: `#`, a lock, an emoji or a customer's logo.
			.leading(
				h.channelIcon
					.tile(true)
					.private(channel.type === "private")
					.emoji(channel.icon ?? undefined)
					.customer(
						customer === undefined
							? undefined
							: {
									name: customer.accountName,
									initials: initialsOf(customer.accountName),
									src: customer.accountLogoUrl ?? undefined,
								},
					)
					.sync(sync),
			)
			// HAZEL-GAP(p4-item-title-mark): today's favorite star sits right after the name, not at the row's end.
			.trailing(channel.isFavorite ? h.text.tone("warning").children("★") : undefined)
			.badge(channel.notificationCount)
			.muted(channel.isMuted)
			.href(channelHref(orgSlug, channel))
	)
}

/** A DM: the partner and their presence, or a group's first three faces. */
export const dmCard = <Msg>(
	h: Hazel.H<Msg>,
	orgSlug: string,
	channel: ChannelSummary,
	userId: UserId,
	presence: Readonly<Record<string, Presence>>,
) => {
	const others = otherMembers(channel, userId)
	const only = others[0]
	const row = h.item
		.key(channel.id)
		.badge(channel.notificationCount)
		.muted(channel.isMuted)
		.leadingSize("large")
		.href(channelHref(orgSlug, channel))
	if (channel.type === "single" && others.length === 1 && only !== undefined) {
		const status = presence[only.userId]
		return row
			.title(fullName(only))
			.subtitle(statusText(status))
			.leading(
				h.avatar
					.name(fullName(only))
					.initials(initialsOf(fullName(only)))
					.src(only.avatarUrl ?? undefined)
					.size("medium")
					.presence(status !== undefined && status !== "offline" ? "online" : "offline"),
			)
	}
	const shown = others.slice(0, 3)
	return row
		.title(
			`${shown.map((member) => member.firstName).join(", ")}${others.length > 3 ? ` +${others.length - 3}` : ""}`,
		)
		.subtitle(`${others.length} participants`)
		.leading(
			h.avatarStack.children(
				...shown.map((member) =>
					h.avatar
						.key(member.userId)
						.name(fullName(member))
						.initials(initialsOf(fullName(member)))
						.src(member.avatarUrl ?? undefined),
				),
			),
		)
}

/** Who and where: the page draws nothing of its own until the session knows both. */
export const scopeOf = (session: Session) =>
	session.organization === null || session.user === null || session.orgSlug === null
		? null
		: { organizationId: session.organization.id, userId: session.user.id, orgSlug: session.orgSlug }

/** The live queries both chat index pages run: channels, partners' presence, icon marks. */
export const chatIndexSubscriptions = <M>(
	scope: { readonly organizationId: OrganizationId; readonly userId: UserId } | null,
	groups: ChannelGroups,
	messages: {
		readonly channels: (groups: ChannelGroups) => M
		readonly presence: (presence: Record<string, Presence>) => M
		/** Only cards that draw icon marks (channels) need them. */
		readonly marks?: (marks: ChannelMarks) => M
	},
) => {
	if (scope === null) return []
	const { organizationId, userId } = scope
	const marks = messages.marks
	return [
		Subscription.make("channels", [organizationId, userId], ([org, user]) =>
			channelsStream(org, user, messages.channels),
		),
		Subscription.make("presence", [partnerIdsOf(groups, userId).join(",")], ([ids]) =>
			ids === ""
				? Stream.empty
				: presenceStream(
						ids.split(",").map((id) => UserId.make(id)),
						messages.presence,
					),
		),
		// One message per change of either: the sidebar's two queries, zipped latest.
		marks === undefined
			? null
			: Subscription.make("marks", [organizationId], ([org]) =>
					Stream.zipLatest(
						customersStream(org, (customers) => customers),
						syncedStream((synced) => synced),
					).pipe(Stream.map(([customers, synced]) => marks({ customers, synced }))),
				),
	]
}

/** Today's card of rows: no padding, a hairline between rows running edge to edge. */
export const cardList = <Msg>(
	h: Hazel.H<Msg>,
	key: string,
	rows: ReadonlyArray<Hazel.Hz<Msg, unknown, "item">>,
) =>
	h.frame
		.key(key)
		.surface("flush")
		.children(
			...rows.flatMap((row, index) => (index === 0 ? [row] : [h.divider.key(`divider:${index}`), row])),
		)
