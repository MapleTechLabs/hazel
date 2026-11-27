/**
 * The palette's live queries over the app's `ClientData` (today's `subscription.ts` and
 * `search-subscription.ts`). Each stream emits the rows as the palette keeps them, on every change.
 */
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, gt, ilike, inArray, isNull, lt, not, or } from "@tanstack/db"
import { Stream } from "effect"
import { type Data, withData } from "../app/live"
import { groupRows } from "../customers/data/groups"
import { withCustomersSourceIn } from "../customers/data/queries"
import { parseDateFilter } from "../lib/search-filter-parser"
import { getFileCategory } from "../lib/utils/file-utils"
import { getEffectivePresenceStatus, type PresenceLike } from "../lib/utils/presence"
import type {
	ChannelSummary,
	CustomerSummary,
	DmChannel,
	SearchFilter,
	SearchResult,
	Suggestion,
} from "./model"
import type { HitLookup } from "./search"

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

const rows = <Row, A>(
	query: (data: Data) => Parameters<Data["liveQueryStream"]>[0],
	map: (rows: ReadonlyArray<Row>) => A,
) => withData((data) => data.liveQueryStream<Row, A>(query(data), map))

/** The user's visible public and private channels in the org, by name. */
export const channelsStream = (organizationId: OrganizationId, userId: UserId) =>
	rows<{ channel: ChannelRow }, ReadonlyArray<ChannelSummary>>(
		({ collections }) =>
			(q) =>
				q
					.from({ channel: collections.channelCollection })
					.innerJoin({ member: collections.channelMemberCollection }, ({ channel, member }) =>
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
		(found) => found.map((row) => toSummary(row.channel)),
	)

interface DmRow {
	readonly channel: ChannelRow
	readonly member: { readonly userId: UserId }
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

/** The org's DMs the user is in, each with its other members. */
export const dmChannelsStream = (organizationId: OrganizationId, userId: UserId) =>
	rows<DmRow, ReadonlyArray<DmChannel>>(
		({ collections }) =>
			(q) =>
				q
					.from({ channel: collections.channelCollection })
					.innerJoin({ member: collections.channelMemberCollection }, ({ channel, member }) =>
						eq(member.channelId, channel.id),
					)
					.innerJoin({ user: collections.userCollection }, ({ member, user }) =>
						eq(member.userId, user.id),
					)
					.where((t) =>
						and(
							eq(t.channel.organizationId, organizationId),
							or(eq(t.channel.type, "single"), eq(t.channel.type, "direct")),
						),
					),
		(found) => {
			const byChannel = new Map<string, { channel: ChannelRow; members: Array<DmRow> }>()
			for (const row of found) {
				const entry = byChannel.get(row.channel.id) ?? { channel: row.channel, members: [] }
				entry.members.push(row)
				byChannel.set(row.channel.id, entry)
			}
			return [...byChannel.values()]
				.filter(({ members }) => members.some((row) => row.member.userId === userId))
				.map(({ channel, members }) => ({
					id: channel.id,
					type: channel.type,
					otherMembers: members
						.filter((row) => row.member.userId !== userId)
						.map((row) => ({
							userId: row.member.userId,
							firstName: row.user.firstName,
							lastName: row.user.lastName,
							avatarUrl: row.user.avatarUrl ?? null,
						})),
				}))
		},
	)

interface AccountRow {
	readonly id: CustomerSummary["id"]
	readonly name: string
	readonly domains: ReadonlyArray<string>
	readonly logoUrl: string | null
	readonly primaryAccountId: CustomerSummary["id"] | null
	readonly environment: string | null
}

/** The org's live customer accounts by name, a customer's environments together, primary first. */
export const customersStream = (organizationId: OrganizationId) =>
	withData((data) =>
		withCustomersSourceIn(data)(
			organizationId,
			data.liveQueryStream<AccountRow, ReadonlyArray<CustomerSummary>>(
				(q) =>
					q
						.from({ account: data.collections.customerAccountCollection })
						.where(({ account }) =>
							and(eq(account.organizationId, organizationId), isNull(account.deletedAt)),
						)
						.orderBy(({ account }) => account.name, "asc"),
				(found) =>
					groupRows(
						found.map((account) => ({
							id: account.id,
							name: account.name,
							domains: account.domains,
							logoUrl: account.logoUrl,
							primaryAccountId: account.primaryAccountId,
							environment: account.environment,
						})),
						new Set(found.map((account) => account.id)),
					).map(({ primaryAccountId: _, ...customer }) => customer),
			),
		),
	)

/** The recent channels that are still in the org. */
export const recentChannelsStream = (organizationId: OrganizationId, channelIds: ReadonlyArray<ChannelId>) =>
	rows<ChannelRow, ReadonlyArray<ChannelSummary>>(
		({ collections }) =>
			(q) =>
				q
					.from({ channel: collections.channelCollection })
					.where(({ channel }) =>
						and(eq(channel.organizationId, organizationId), inArray(channel.id, [...channelIds])),
					)
					.select(({ channel }) => ({ ...channel })),
		(found) => found.map(toSummary),
	)

/** The user's status as presence shows it; never offline for the local user. */
export const presenceStream = (userId: UserId) =>
	rows<PresenceLike, string>(
		({ collections }) =>
			(q) =>
				q
					.from({ presence: collections.userPresenceStatusCollection })
					.where(({ presence }) => eq(presence.userId, userId))
					.orderBy(({ presence }) => presence.updatedAt, "desc")
					.findOne(),
		(found) => {
			const status = getEffectivePresenceStatus(found[0])
			return status === "offline" ? "online" : status
		},
	)

/** Every channel the user is a member of (the join page's first query). */
export const memberChannelIdsStream = (userId: UserId) =>
	rows<{ channelId: ChannelId }, ReadonlyArray<ChannelId>>(
		({ collections }) =>
			(q) =>
				q
					.from({ m: collections.channelMemberCollection })
					.where(({ m }) => eq(m.userId, userId))
					.select(({ m }) => ({ channelId: m.channelId })),
		(found) => found.map((row) => row.channelId),
	)

/** The org's public and private channels the user has not joined. */
export const unjoinedChannelsStream = (organizationId: OrganizationId, memberIds: ReadonlyArray<ChannelId>) =>
	rows<ChannelRow, ReadonlyArray<ChannelSummary>>(
		({ collections }) =>
			(q) => {
				const base = q
					.from({ channel: collections.channelCollection })
					.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
					.where(({ channel }) => eq(channel.organizationId, organizationId))
				return (
					memberIds.length === 0
						? base
						: base.where(({ channel }) => not(inArray(channel.id, [...memberIds])))
				).select(({ channel }) => ({ ...channel }))
			},
		(found) => found.map(toSummary),
	)

// SEARCH

/** The channels the user can read in the org. */
const accessibleChannelsStream = (
	{ collections, liveQueryStream }: Data,
	organizationId: OrganizationId,
	userId: UserId,
) =>
	liveQueryStream<{ id: ChannelId }, ReadonlyArray<ChannelId>>(
		(q) =>
			q
				.from({ member: collections.channelMemberCollection })
				.innerJoin({ channel: collections.channelCollection }, ({ member, channel }) =>
					eq(member.channelId, channel.id),
				)
				.where(({ member, channel }) =>
					and(eq(member.userId, userId), eq(channel.organizationId, organizationId)),
				)
				.select(({ channel }) => ({ id: channel.id })),
		(found) => found.map((row) => row.id),
	)

interface ResultRow {
	readonly message: {
		readonly id: SearchResult["messageId"]
		readonly channelId: ChannelId
		readonly content: string
		readonly createdAt: Date
		readonly embeds?: unknown
	}
	readonly author?: {
		readonly firstName?: string
		readonly lastName?: string
		readonly avatarUrl?: string | null
	} | null
	readonly channel?: { readonly name: string } | null
}

interface AttachmentRow {
	readonly messageId: string | null
	readonly fileName: string
}

const dateOf = (filter: SearchFilter | undefined) => (filter ? parseDateFilter(filter.value) : null)

/** `has:` as today applies it: files and images by attachment, links by text, embeds by field. */
const toResults = (
	found: ReadonlyArray<ResultRow>,
	attachments: ReadonlyArray<AttachmentRow>,
	has: SearchFilter | undefined,
): ReadonlyArray<SearchResult> => {
	const counts = new Map<string, number>()
	const types = new Map<string, Set<string>>()
	for (const attachment of attachments) {
		if (!attachment.messageId) continue
		counts.set(attachment.messageId, (counts.get(attachment.messageId) ?? 0) + 1)
		const set = types.get(attachment.messageId) ?? new Set<string>()
		if (getFileCategory(attachment.fileName) === "image") set.add("image")
		set.add("file")
		types.set(attachment.messageId, set)
	}
	const hasType = has?.value.toLowerCase()
	const kept = found.filter((row) =>
		hasType === "image" || hasType === "file"
			? (types.get(row.message.id)?.has(hasType) ?? false)
			: hasType === "link"
				? /https?:\/\/[^\s]+/i.test(row.message.content)
				: hasType === "embed"
					? typeof row.message.embeds === "object" &&
						row.message.embeds !== null &&
						Object.keys(row.message.embeds).length > 0
					: true,
	)
	return kept.map((row): SearchResult => ({
		messageId: row.message.id,
		channelId: row.message.channelId,
		content: row.message.content,
		createdAtMs: new Date(row.message.createdAt).getTime(),
		authorName: row.author
			? `${row.author.firstName ?? ""} ${row.author.lastName ?? ""}`.trim()
			: "Unknown",
		authorAvatarUrl: row.author?.avatarUrl ?? null,
		channelName: row.channel?.name ?? null,
		attachmentCount: counts.get(row.message.id) ?? 0,
	}))
}

/** The query over the messages loaded this session (messages sync per open channel), filters applied. */
const loadedResultsStream = (
	data: Data,
	channelIds: ReadonlyArray<ChannelId>,
	query: string,
	filters: ReadonlyArray<SearchFilter>,
): Stream.Stream<ReadonlyArray<SearchResult>> => {
	const find = (type: SearchFilter["type"]) => filters.find((filter) => filter.type === type)
	const from = find("from")
	const inChannel = find("in")
	const has = find("has")
	const before = dateOf(find("before"))
	const after = dateOf(find("after"))
	const loaded = data.openChannelIds()
	const searchIds = (inChannel ? channelIds.filter((id) => id === inChannel.id) : channelIds).filter((id) =>
		loaded.has(id),
	)
	if (searchIds.length === 0) return Stream.succeed([])
	const { messageCollection, userCollection, channelCollection, attachmentCollection } = data.collections
	return data
		.liveQueryStream<ResultRow, ReadonlyArray<ResultRow>>(
			(q) => {
				let builder = q
					.from({ message: messageCollection })
					.leftJoin({ author: userCollection }, ({ message, author }) =>
						eq(message.authorId, author.id),
					)
					.leftJoin({ channel: channelCollection }, ({ message, channel }) =>
						eq(message.channelId, channel.id),
					)
					.where(({ message }) => inArray(message.channelId, [...searchIds]))
				if (query.trim())
					builder = builder.where(({ message }) => ilike(message.content, `%${query.trim()}%`))
				if (from) builder = builder.where(({ message }) => eq(message.authorId, from.id))
				if (before) builder = builder.where(({ message }) => lt(message.createdAt, before))
				if (after) builder = builder.where(({ message }) => gt(message.createdAt, after))
				return builder
					.orderBy(({ message }) => message.createdAt, "desc")
					.limit(50)
					.select(({ message, author, channel }) => ({ message, author, channel }))
			},
			(found) => found,
		)
		.pipe(
			Stream.switchMap((found) =>
				(found.length === 0
					? Stream.succeed<ReadonlyArray<AttachmentRow>>([])
					: data.liveQueryStream<AttachmentRow, ReadonlyArray<AttachmentRow>>(
							(q) =>
								q
									.from({ attachment: attachmentCollection })
									.where(({ attachment }) =>
										and(
											inArray(
												attachment.messageId,
												found.map((row) => row.message.id),
											),
											eq(attachment.status, "complete"),
										),
									)
									.select(({ attachment }) => ({
										messageId: attachment.messageId,
										fileName: attachment.fileName,
									})),
							(attachments) => attachments,
						)
				).pipe(Stream.map((attachments) => toResults(found, attachments, has))),
			),
		)
}

/** Local search: the loaded messages of every channel the user can read. */
export const localResultsStream = (
	organizationId: OrganizationId,
	userId: UserId,
	query: string,
	filters: ReadonlyArray<SearchFilter>,
) =>
	withData((data) =>
		accessibleChannelsStream(data, organizationId, userId).pipe(
			Stream.switchMap((channelIds) => loadedResultsStream(data, channelIds, query, filters)),
		),
	)

interface UserRow {
	readonly id: string
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl?: string | null
}

const userQuery = (
	data: Data,
	organizationId: OrganizationId,
	partial: string,
	field: "firstName" | "lastName",
) =>
	data.liveQueryStream<UserRow, ReadonlyArray<UserRow>>(
		(q) =>
			q
				.from({ user: data.collections.userCollection })
				.innerJoin({ member: data.collections.organizationMemberCollection }, ({ user, member }) =>
					eq(user.id, member.userId),
				)
				.where(({ user, member }) =>
					and(
						eq(member.organizationId, organizationId),
						isNull(member.deletedAt),
						ilike(user[field], `%${partial}%`),
					),
				)
				.orderBy(({ user }) => user[field], "asc")
				.limit(20)
				.select(({ user }) => ({ ...user })),
		(found) => found,
	)

/** `from:` people: first-name matches, then last-name matches, deduplicated, at most ten. */
export const userSuggestionsStream = (organizationId: OrganizationId, partial: string) =>
	withData((data) =>
		Stream.zipLatest(
			userQuery(data, organizationId, partial, "firstName"),
			userQuery(data, organizationId, partial, "lastName"),
		).pipe(
			Stream.map(([byFirst, byLast]) => {
				const byId = new Map<string, UserRow>()
				for (const user of [...byFirst, ...byLast]) byId.set(user.id, user)
				return [...byId.values()].slice(0, 10).map((user): Suggestion => ({
					id: user.id,
					label: `${user.firstName} ${user.lastName}`.trim(),
					avatarUrl: user.avatarUrl ?? null,
					kind: "user",
				}))
			}),
		),
	)

/** `in:` channels the user is in whose name has the typed text. */
export const channelSuggestionsStream = (organizationId: OrganizationId, userId: UserId, partial: string) =>
	partial.length === 0
		? Stream.succeed<ReadonlyArray<Suggestion>>([])
		: rows<{ id: string; name: string }, ReadonlyArray<Suggestion>>(
				({ collections }) =>
					(q) =>
						q
							.from({ channel: collections.channelCollection })
							.innerJoin(
								{ member: collections.channelMemberCollection },
								({ channel, member }) => eq(channel.id, member.channelId),
							)
							.where(({ channel, member }) =>
								and(eq(channel.organizationId, organizationId), eq(member.userId, userId)),
							)
							.orderBy(({ channel }) => channel.name, "asc")
							.select(({ channel }) => ({ ...channel }))
							.limit(10),
				(found) =>
					found
						.filter((row) => row.name.toLowerCase().includes(partial.toLowerCase()))
						.map((row) => ({
							id: row.id,
							label: row.name,
							avatarUrl: null,
							kind: "channel" as const,
						})),
			)

/** Names for server hits, from the synced users and channels. */
export const hitLookupOf = (data: Data): HitLookup => ({
	authorOf: (hit) => {
		const user = data.collections.userCollection.get(hit.authorId)
		return user === undefined
			? null
			: {
					name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
					avatarUrl: user.avatarUrl ?? null,
				}
	},
	channelNameOf: (channelId) => data.collections.channelCollection.get(channelId)?.name ?? null,
})
