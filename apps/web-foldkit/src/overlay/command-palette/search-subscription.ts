import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, gt, ilike, inArray, isNull, lt } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	attachmentCollection,
	channelCollection,
	channelMemberCollection,
	messageCollection,
	organizationMemberCollection,
	userCollection,
} from "~/db/collections"
import { HAS_FILTER_VALUES, parseDateFilter } from "~/lib/search-filter-parser"
import { getFileCategory } from "~/utils/file-utils"
import { liveQueryStream } from "../../data/live-query"
import { Message } from "./message"
import { SearchFilter, type SearchResult, type Suggestion } from "./search-data"
import type { Input } from "./subscription"

/** `useSearchQuery`, `useUserSuggestions` and `useChannelSuggestions`, while the search page shows. */

interface ResultRow {
	readonly message: {
		readonly id: SearchResult["messageId"]
		readonly channelId: ChannelId
		readonly content: string
		readonly createdAt: Date
		readonly embeds?: unknown
	}
	readonly author?: { readonly firstName?: string; readonly lastName?: string; readonly avatarUrl?: string | null } | null
	readonly channel?: { readonly name: string } | null
}

interface AttachmentRow {
	readonly messageId: string | null
	readonly fileName: string
}

const searchContext = (input: Input) =>
	input.model.isOpen && input.model.page._tag === "Search"
		? { organizationId: input.shared.organization?.id ?? null, userId: input.shared.currentUser?.id ?? null }
		: { organizationId: null, userId: null }

const accessibleChannels = (organizationId: OrganizationId, userId: UserId) =>
	liveQueryStream<{ id: ChannelId }, ReadonlyArray<ChannelId>>(
		(q) =>
			q
				.from({ member: channelMemberCollection })
				.innerJoin({ channel: channelCollection }, ({ member, channel }) => eq(member.channelId, channel.id))
				.where(({ member, channel }) => and(eq(member.userId, userId), eq(channel.organizationId, organizationId)))
				.select(({ channel }) => ({ id: channel.id })),
		(rows) => rows.map((row) => row.id),
	)

/** The results query plus its attachments, with the `has:` filter applied as legacy does. */
const resultsStream = (channelIds: ReadonlyArray<ChannelId>, query: string, filters: ReadonlyArray<SearchFilter>) => {
	const find = (type: SearchFilter["type"]) => filters.find((filter) => filter.type === type)
	const from = find("from")
	const inChannel = find("in")
	const has = find("has")
	const before = dateOf(find("before"))
	const after = dateOf(find("after"))
	const searchIds = inChannel ? channelIds.filter((id) => id === inChannel.id) : channelIds
	const shouldSearch = (query.trim().length > 0 || filters.length > 0) && searchIds.length > 0
	if (!shouldSearch) return Stream.succeed(Message.UpdatedSearchData({ data: { results: [], isLoading: false, hasQuery: false } }))
	return liveQueryStream<ResultRow, ReadonlyArray<ResultRow>>(
		(q) => {
			let builder = q
				.from({ message: messageCollection })
				.leftJoin({ author: userCollection }, ({ message, author }) => eq(message.authorId, author.id))
				.leftJoin({ channel: channelCollection }, ({ message, channel }) => eq(message.channelId, channel.id))
				.where(({ message }) => inArray(message.channelId, [...searchIds]))
			if (query.trim()) builder = builder.where(({ message }) => ilike(message.content, `%${query.trim()}%`))
			if (from) builder = builder.where(({ message }) => eq(message.authorId, from.id))
			if (before) builder = builder.where(({ message }) => lt(message.createdAt, before))
			if (after) builder = builder.where(({ message }) => gt(message.createdAt, after))
			return builder
				.orderBy(({ message }) => message.createdAt, "desc")
				.limit(50)
				.select(({ message, author, channel }) => ({ message, author, channel }))
		},
		(rows) => rows,
	).pipe(
		Stream.switchMap(
			(rows) =>
				(rows.length === 0
					? Stream.succeed<ReadonlyArray<AttachmentRow>>([])
					: liveQueryStream<AttachmentRow, ReadonlyArray<AttachmentRow>>(
							(q) =>
								q
									.from({ attachment: attachmentCollection })
									.where(({ attachment }) =>
										and(
											inArray(attachment.messageId, rows.map((row) => row.message.id)),
											eq(attachment.status, "complete"),
										),
									)
									.select(({ attachment }) => ({ messageId: attachment.messageId, fileName: attachment.fileName })),
							(attachments) => attachments,
						)
				).pipe(Stream.map((attachments) => Message.UpdatedSearchData({ data: toData(rows, attachments, has) }))),
		),
	)
}

const dateOf = (filter: SearchFilter | undefined) => (filter ? parseDateFilter(filter.value) : null)

const toData = (rows: ReadonlyArray<ResultRow>, attachments: ReadonlyArray<AttachmentRow>, has: SearchFilter | undefined) => {
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
	const kept = rows.filter((row) =>
		hasType === "image" || hasType === "file"
			? (types.get(row.message.id)?.has(hasType) ?? false)
			: hasType === "link"
				? /https?:\/\/[^\s]+/i.test(row.message.content)
				: hasType === "embed"
					? typeof row.message.embeds === "object" && row.message.embeds !== null && Object.keys(row.message.embeds).length > 0
					: true,
	)
	return {
		results: kept.map((row) => ({
			messageId: row.message.id,
			channelId: row.message.channelId,
			content: row.message.content,
			createdAtMs: new Date(row.message.createdAt).getTime(),
			authorName: row.author ? `${row.author.firstName ?? ""} ${row.author.lastName ?? ""}`.trim() : "Unknown",
			authorAvatarUrl: row.author?.avatarUrl ?? null,
			channelName: row.channel?.name ?? null,
			attachmentCount: counts.get(row.message.id) ?? 0,
		})),
		isLoading: false,
		hasQuery: true,
	}
}

interface UserRow {
	readonly id: string
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl?: string | null
}

const userQuery = (organizationId: OrganizationId, partial: string, field: "firstName" | "lastName") =>
	liveQueryStream<UserRow, ReadonlyArray<UserRow>>(
		(q) =>
			q
				.from({ user: userCollection })
				.innerJoin({ member: organizationMemberCollection }, ({ user, member }) => eq(user.id, member.userId))
				.where(({ user, member }) =>
					and(eq(member.organizationId, organizationId), isNull(member.deletedAt), ilike(user[field], `%${partial}%`)),
				)
				.orderBy(({ user }) => user[field], "asc")
				.limit(20)
				.select(({ user }) => ({ ...user })),
		(rows) => rows,
	)

/** `useUserSuggestions`: first-name matches, then last-name matches, deduplicated, at most ten. */
const userSuggestions = (organizationId: OrganizationId, partial: string) =>
	Stream.zipLatest(userQuery(organizationId, partial, "firstName"), userQuery(organizationId, partial, "lastName")).pipe(
		Stream.map(([byFirst, byLast]) => {
			const byId = new Map<string, UserRow>()
			for (const user of [...byFirst, ...byLast]) byId.set(user.id, user)
			return [...byId.values()].slice(0, 10).map(
				(user): Suggestion => ({
					id: user.id,
					label: `${user.firstName} ${user.lastName}`.trim(),
					avatarUrl: user.avatarUrl ?? null,
					kind: "user",
				}),
			)
		}),
	)

const channelSuggestions = (organizationId: OrganizationId, userId: UserId, partial: string) =>
	partial.length === 0
		? Stream.succeed<ReadonlyArray<Suggestion>>([])
		: liveQueryStream<{ id: string; name: string }, ReadonlyArray<Suggestion>>(
				(q) =>
					q
						.from({ channel: channelCollection })
						.innerJoin({ member: channelMemberCollection }, ({ channel, member }) => eq(channel.id, member.channelId))
						.where(({ channel, member }) => and(eq(channel.organizationId, organizationId), eq(member.userId, userId)))
						.orderBy(({ channel }) => channel.name, "asc")
						.select(({ channel }) => ({ ...channel }))
						.limit(10),
				(rows) =>
					rows
						.filter((row) => row.name.toLowerCase().includes(partial.toLowerCase()))
						.map((row) => ({ id: row.id, label: row.name, avatarUrl: null, kind: "channel" as const })),
			)

const Context = { organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) }

export const searchSubscriptions = Subscription.make<Input, Message>()((entry) => ({
	searchResults: entry(
		{ ...Context, query: Schema.String, filters: Schema.Array(SearchFilter) },
		{
			modelToDependencies: (input) => {
				const page = input.model.page
				return {
					...searchContext(input),
					query: page._tag === "Search" ? page.query : "",
					filters: page._tag === "Search" ? page.filters : [],
				}
			},
			dependenciesToStream: ({ organizationId, userId, query, filters }) =>
				organizationId === null || userId === null
					? Stream.empty
					: accessibleChannels(organizationId, userId).pipe(
							Stream.switchMap((channelIds) => resultsStream(channelIds, query, filters)),
						),
		},
	),
	searchSuggestions: entry(
		{ ...Context, filterType: Schema.NullOr(Schema.String), search: Schema.String },
		{
			modelToDependencies: (input) => ({
				...searchContext(input),
				filterType: input.model.searchAutocomplete?.filterType ?? null,
				search: input.model.searchAutocomplete?.search ?? "",
			}),
			dependenciesToStream: ({ organizationId, userId, filterType, search }) => {
				const toMessage = (suggestions: ReadonlyArray<Suggestion>) => Message.UpdatedSuggestions({ suggestions })
				if (organizationId === null || userId === null || filterType === null) return Stream.succeed(toMessage([]))
				if (filterType === "from") return userSuggestions(organizationId, search).pipe(Stream.map(toMessage))
				if (filterType === "in") return channelSuggestions(organizationId, userId, search).pipe(Stream.map(toMessage))
				return Stream.succeed(
					toMessage(
						HAS_FILTER_VALUES.filter((value) => value.toLowerCase().includes(search.toLowerCase())).map((value) => ({
							id: value,
							label: value,
							avatarUrl: null,
							kind: "has" as const,
						})),
					),
				)
			},
		},
	),
}))
