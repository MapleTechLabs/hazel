import type { Attachment, Channel, Message, User } from "@hazel/domain/models"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, gt, ilike, inArray, isNull, lt, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import {
	attachmentCollection,
	channelCollection,
	channelMemberCollection,
	messageCollection,
	organizationMemberCollection,
	userCollection,
} from "~/db/collections"
import { parseDateFilter, type SearchFilter } from "~/lib/search-filter-parser"
import { getFileCategory } from "~/utils/file-utils"

export interface SearchResult {
	message: Message.Type
	author: User.Type | null
	channel: Channel.Type | null
	attachmentCount: number
}

interface UseSearchQueryOptions {
	query: string
	filters: SearchFilter[]
	organizationId: OrganizationId | null
	userId: UserId | undefined
	limit?: number
}

/**
 * Hook to execute search queries against Electric SQL collections
 */
export function useSearchQuery({
	query,
	filters,
	organizationId,
	userId,
	limit = 50,
}: UseSearchQueryOptions) {
	// First, get accessible channel IDs (channels where user is a member)
	const { data: accessibleChannels } = useLiveQuery({
		query: (q) =>
			organizationId && userId
				? q
						.from({ member: channelMemberCollection })
						.innerJoin({ channel: channelCollection }, ({ member, channel }) =>
							eq(member.channelId, channel.id),
						)
						.where(({ member, channel }) =>
							and(eq(member.userId, userId), eq(channel.organizationId, organizationId)),
						)
						.select(({ channel }) => ({ id: channel.id }))
				: null,
		queryKey: [organizationId, userId],
	})

	const accessibleChannelIds = useMemo(
		() => accessibleChannels?.map((c) => c.id) ?? [],
		[accessibleChannels],
	)

	// Extract filter values
	const fromFilter = filters.find((f) => f.type === "from")
	const inFilter = filters.find((f) => f.type === "in")
	const hasFilter = filters.find((f) => f.type === "has")
	const beforeFilter = filters.find((f) => f.type === "before")
	const afterFilter = filters.find((f) => f.type === "after")

	// Parse date filters
	const beforeDate = beforeFilter ? parseDateFilter(beforeFilter.value) : null
	const afterDate = afterFilter ? parseDateFilter(afterFilter.value) : null

	// Determine which channel IDs to search
	const searchChannelIds = useMemo(() => {
		if (inFilter) {
			// If filtering by specific channel, only search that channel (if accessible)
			const filteredId = inFilter.id as ChannelId
			return accessibleChannelIds.includes(filteredId) ? [filteredId] : []
		}
		return accessibleChannelIds
	}, [inFilter, accessibleChannelIds])

	// Check if we should search (have something to search for)
	const shouldSearch = (query.trim().length > 0 || filters.length > 0) && searchChannelIds.length > 0

	// Main search query
	const { data: searchResults, status } = useLiveQuery({
		query: (q) => {
			if (!shouldSearch || searchChannelIds.length === 0) {
				return null
			}

			let queryBuilder = q
				.from({ message: messageCollection })
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.leftJoin({ channel: channelCollection }, ({ message, channel }) =>
					eq(message.channelId, channel.id),
				)
				.where(({ message }) => inArray(message.channelId, searchChannelIds))

			// Apply text search if query is provided
			if (query.trim().length > 0) {
				queryBuilder = queryBuilder.where(({ message }) =>
					ilike(message.content, `%${query.trim()}%`),
				)
			}

			// Apply from filter
			if (fromFilter) {
				queryBuilder = queryBuilder.where(({ message }) =>
					eq(message.authorId, fromFilter.id as UserId),
				)
			}

			// Apply date filters
			if (beforeDate) {
				queryBuilder = queryBuilder.where(({ message }) => lt(message.createdAt, beforeDate))
			}

			if (afterDate) {
				queryBuilder = queryBuilder.where(({ message }) => gt(message.createdAt, afterDate))
			}

			return queryBuilder
				.orderBy(({ message }) => message.createdAt, "desc")
				.limit(limit)
				.select(({ message, author, channel }) => ({
					message,
					author,
					channel,
				}))
		},
		queryKey: [shouldSearch, searchChannelIds, query, fromFilter?.id, beforeDate, afterDate, limit],
	})

	// Get message IDs for attachment count query
	const messageIds = useMemo(() => searchResults?.map((r) => r.message.id) ?? [], [searchResults])

	// Query attachment counts for results
	const { data: attachmentData } = useLiveQuery({
		query: (q) =>
			messageIds.length > 0
				? q
						.from({ attachment: attachmentCollection })
						.where(({ attachment }) =>
							and(inArray(attachment.messageId, messageIds), eq(attachment.status, "complete")),
						)
						.select(({ attachment }) => ({
							messageId: attachment.messageId,
							fileName: attachment.fileName,
						}))
				: null,
		queryKey: [messageIds],
	})

	// Build attachment count map and filter by "has" if needed
	const attachmentCountMap = useMemo(() => {
		const map = new Map<string, number>()
		const hasAttachmentMap = new Map<string, Set<string>>()

		attachmentData?.forEach((a) => {
			// Skip if messageId is null
			if (!a.messageId) return

			map.set(a.messageId, (map.get(a.messageId) ?? 0) + 1)

			// Track attachment types for "has" filter
			if (!hasAttachmentMap.has(a.messageId)) {
				hasAttachmentMap.set(a.messageId, new Set())
			}

			const types = hasAttachmentMap.get(a.messageId)!
			const category = getFileCategory(a.fileName)
			if (category === "image") {
				types.add("image")
			}
			// All attachments count as "file"
			types.add("file")
		})

		return { counts: map, types: hasAttachmentMap }
	}, [attachmentData])

	// Final results with attachment counts and "has" filtering
	const results: SearchResult[] = useMemo(() => {
		if (!searchResults) return []

		// TanStack DB 0.6 wraps query rows in WithVirtualProps<T> — cast away the
		// extra $synced/$origin/$key/$collectionId fields since our SearchResult
		// shape doesn't include them.
		let filtered = searchResults as unknown as SearchResult[]

		// Apply "has" filter
		if (hasFilter) {
			const hasType = hasFilter.value.toLowerCase()

			if (hasType === "image" || hasType === "file") {
				filtered = filtered.filter((r) => {
					const types = attachmentCountMap.types.get(r.message.id)
					return types?.has(hasType) ?? false
				})
			} else if (hasType === "link") {
				// Check for URLs in content
				const urlRegex = /https?:\/\/[^\s]+/i
				filtered = filtered.filter((r) => urlRegex.test(r.message.content))
			} else if (hasType === "embed") {
				filtered = filtered.filter(
					(r) => r.message.embeds && Object.keys(r.message.embeds).length > 0,
				)
			}
		}

		return filtered.map((r) => ({
			message: r.message,
			author: r.author ?? null,
			channel: r.channel ?? null,
			attachmentCount: attachmentCountMap.counts.get(r.message.id) ?? 0,
		}))
	}, [searchResults, hasFilter, attachmentCountMap])

	return {
		results,
		isLoading: status === "loading",
		isEmpty: shouldSearch && results.length === 0,
		hasQuery: shouldSearch,
	}
}

/**
 * Hook to get user suggestions for "from:" filter autocomplete
 */
export function useUserSuggestions(partial: string, organizationId: OrganizationId | null) {
	// Query users by firstName, filtered by organization membership
	const { data: users } = useLiveQuery({
		query: (q) => {
			if (!organizationId) return null

			let query = q
				.from({ user: userCollection })
				.innerJoin({ member: organizationMemberCollection }, ({ user, member }) =>
					eq(user.id, member.userId),
				)
				.where(({ member }) =>
					and(eq(member.organizationId, organizationId), isNull(member.deletedAt)),
				)

			if (partial.length > 0) {
				query = query.where(({ user }) => ilike(user.firstName, `%${partial}%`))
			}

			return query
				.orderBy(({ user }) => user.firstName, "asc")
				.limit(20)
				.select(({ user }) => ({ ...user }))
		},
		queryKey: [organizationId, partial],
	})

	// Also query by lastName if partial is provided
	const { data: usersByLastName } = useLiveQuery({
		query: (q) => {
			if (!organizationId || partial.length === 0) return null

			return q
				.from({ user: userCollection })
				.innerJoin({ member: organizationMemberCollection }, ({ user, member }) =>
					eq(user.id, member.userId),
				)
				.where(({ user, member }) =>
					and(
						eq(member.organizationId, organizationId),
						isNull(member.deletedAt),
						ilike(user.lastName, `%${partial}%`),
					),
				)
				.orderBy(({ user }) => user.lastName, "asc")
				.limit(20)
				.select(({ user }) => ({ ...user }))
		},
		queryKey: [organizationId, partial],
	})

	// Merge and deduplicate results
	const filteredUsers = useMemo(() => {
		if (!users) return []

		const userMap = new Map<string, NonNullable<typeof users>[0]>()

		// Add users from firstName query
		users.forEach((u) => userMap.set(u.id, u))

		// Add users from lastName query
		usersByLastName?.forEach((u) => userMap.set(u.id, u))

		return Array.from(userMap.values()).slice(0, 10)
	}, [users, usersByLastName])

	return filteredUsers
}

/**
 * Hook to get channel suggestions for "in:" filter autocomplete
 */
export function useChannelSuggestions(
	partial: string,
	organizationId: OrganizationId | null,
	userId: UserId | undefined,
) {
	const { data: channels } = useLiveQuery({
		query: (q) =>
			organizationId && userId && partial.length > 0
				? q
						.from({ channel: channelCollection })
						.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
							eq(channel.id, member.channelId),
						)
						.where(({ channel, member }) =>
							and(eq(channel.organizationId, organizationId), eq(member.userId, userId)),
						)
						.orderBy(({ channel }) => channel.name, "asc")
						.select(({ channel }) => ({ ...channel }))
						.limit(10)
				: null,
		queryKey: [organizationId, userId, partial],
	})

	// Filter channels by partial match
	const filteredChannels = useMemo(() => {
		if (!channels || !partial) return []
		const lowered = partial.toLowerCase()
		return channels.filter((c) => c.name.toLowerCase().includes(lowered))
	}, [channels, partial])

	return filteredChannels
}
