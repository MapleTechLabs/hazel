import type { Bot, Channel, ChannelMember, IntegrationConnection, User } from "@hazel/domain/models"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, gte, inArray, isNull, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { useAuth } from "~/lib/auth"
import {
	attachmentCollection,
	botCollection,
	botInstallationCollection,
	channelCollection,
	integrationConnectionCollection,
	messageCollection,
	userCollection,
} from "./collections"
import { channelMemberWithUserCollection, threadWithMemberCollection } from "./materialized-collections"

export const useMessage = (messageId: MessageId) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ message: messageCollection })
				.innerJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.where((q) => eq(q.message.id, messageId))
				.findOne()
				.select(({ message, author }) => ({ ...message, author: author }))
				.orderBy((q) => q.message.createdAt, "desc"),
		queryKey: [messageId],
	})

	return {
		data,
		...rest,
	}
}

type ChannelWithMembers = Channel.Type & {
	members: (ChannelMember.Type & {
		user: User.Type
	})[]
}

export const useChannel = (channelId: ChannelId) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where((t) => eq(t.channel.id, channelId))
				.innerJoin({ member: channelMemberWithUserCollection }, ({ channel, member }) =>
					eq(channel.id, member.channelId),
				),
		queryKey: [channelId],
	})

	const channelWithMember = data.reduce(
		(acc, row) => {
			if (!acc) {
				acc = { ...row.channel, members: [] }
			}
			acc.members.push(row.member)
			return acc
		},
		null as ChannelWithMembers | null,
	)

	return {
		channel: channelWithMember,
		...rest,
	}
}

/**
 * Hook to fetch a parent channel by ID (used for thread breadcrumbs)
 * Only fetches the channel itself, not members
 */
export const useParentChannel = (parentChannelId: ChannelId | null) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			parentChannelId
				? q
						.from({ channel: channelCollection })
						.where((t) => eq(t.channel.id, parentChannelId))
						.findOne()
				: null,
		queryKey: [parentChannelId],
	})

	return {
		parentChannel: data ?? null,
		...rest,
	}
}

export const useChannelWithCurrentUser = (channelId: ChannelId) => {
	const { user } = useAuth()

	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where((t) => eq(t.channel.id, channelId))
				.innerJoin({ member: channelMemberWithUserCollection }, ({ channel, member }) =>
					eq(channel.id, member.channelId),
				),
		queryKey: [channelId],
	})

	const channelWithMember = data.reduce(
		(acc, row) => {
			if (!acc) {
				acc = { ...row.channel, members: [] }
			}
			acc.members.push(row.member)
			return acc
		},
		null as ChannelWithMembers | null,
	)

	const currentUserMember = channelWithMember?.members.find((m) => m.userId === user?.id)

	if (!currentUserMember) {
		return {
			channel: null,
			...rest,
		}
	}

	return {
		channel: { ...channelWithMember, currentUser: currentUserMember },

		...rest,
	}
}

export const useAttachments = (messageId: MessageId) => {
	const { data: attachments, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({
					attachments: attachmentCollection,
				})
				.where(({ attachments }) => eq(attachments.messageId, messageId))
				.orderBy(({ attachments }) => attachments.uploadedAt, "asc"),
		queryKey: [messageId],
	})

	return {
		attachments: attachments || [],
		rest,
	}
}

export const useChannelAttachments = (channelId: ChannelId) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ attachments: attachmentCollection })
				.leftJoin({ user: userCollection }, ({ attachments, user }) =>
					eq(attachments.uploadedBy, user.id),
				)
				.where(({ attachments }) =>
					and(
						eq(attachments.channelId, channelId),
						eq(attachments.status, "complete"),
						isNull(attachments.deletedAt),
					),
				)
				.orderBy(({ attachments }) => attachments.uploadedAt, "desc"),
		queryKey: [channelId],
	})

	return {
		attachments: data || [],
		...rest,
	}
}

/**
 * Query all integration connections for an organization.
 * Returns a map of provider -> connection for easy lookup.
 */
export const useIntegrationConnections = (organizationId: OrganizationId | null) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ connection: integrationConnectionCollection })
				.where(({ connection }) =>
					and(
						eq(connection.organizationId, organizationId ?? ("" as OrganizationId)),
						eq(connection.level, "organization"),
						isNull(connection.userId),
						isNull(connection.deletedAt),
					),
				),
		queryKey: [organizationId],
	})

	// Build a map of provider -> connection for easy lookup
	const connectionsByProvider = new Map<
		IntegrationConnection.IntegrationProvider,
		IntegrationConnection.Type
	>()

	if (organizationId && data) {
		for (const connection of data) {
			connectionsByProvider.set(connection.provider, connection)
		}
	}

	return {
		connections: data ?? [],
		connectionsByProvider,
		isConnected: (provider: IntegrationConnection.IntegrationProvider) => {
			const conn = connectionsByProvider.get(provider)
			return conn?.status === "active"
		},
		...rest,
	}
}

/**
 * Query integration connection by organization and provider.
 * Returns the active connection if one exists.
 */
export const useIntegrationConnection = (
	organizationId: OrganizationId | null,
	provider: IntegrationConnection.IntegrationProvider,
) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ connection: integrationConnectionCollection })
				.where(({ connection }) =>
					and(
						eq(connection.organizationId, organizationId ?? ("" as OrganizationId)),
						eq(connection.provider, provider),
						eq(connection.level, "organization"),
						isNull(connection.userId),
						isNull(connection.deletedAt),
					),
				),
		queryKey: [organizationId, provider],
	})

	// If no organizationId, return empty result
	if (!organizationId) {
		return {
			connection: null,
			isConnected: false,
			...rest,
		}
	}

	const connection = data?.[0] ?? null

	return {
		connection,
		isConnected: connection?.status === "active",
		...rest,
	}
}

/**
 * Query user-level integration connection by organization, user, and provider.
 */
export const useUserIntegrationConnection = (
	organizationId: OrganizationId | null,
	userId: UserId | undefined,
	provider: IntegrationConnection.IntegrationProvider,
) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ connection: integrationConnectionCollection })
				.where(({ connection }) =>
					and(
						eq(connection.organizationId, organizationId ?? ("" as OrganizationId)),
						eq(connection.provider, provider),
						eq(connection.level, "user"),
						eq(connection.userId, userId ?? ("" as UserId)),
						isNull(connection.deletedAt),
					),
				),
		queryKey: [organizationId, userId, provider],
	})

	if (!organizationId || !userId) {
		return {
			connection: null,
			isConnected: false,
			...rest,
		}
	}

	const connection = data?.[0] ?? null

	return {
		connection,
		isConnected: connection?.status === "active",
		...rest,
	}
}

/**
 * Query active threads for the sidebar.
 * Returns threads where the user is a member, has sent a message in the last 3 days,
 * AND has at least 3 messages in the thread.
 * Threads are grouped by their parent channel ID for easy rendering.
 */
export const useActiveThreads = (organizationId: OrganizationId | null, userId: UserId | undefined) => {
	// Calculate 3 days ago (memoized to prevent re-renders)
	const threeDaysAgo = useMemo(() => {
		const date = new Date()
		date.setDate(date.getDate() - 3)
		return date
	}, [])

	// Get threads where user is a member
	const { data: threads } = useLiveQuery({
		query: (q) =>
			q
				.from({ thread: threadWithMemberCollection })
				.where(({ thread }) =>
					and(
						eq(thread.channel.organizationId, organizationId ?? ("" as OrganizationId)),
						eq(thread.member.userId, userId ?? ("" as UserId)),
						eq(thread.member.isHidden, false),
					),
				),
		queryKey: [organizationId, userId],
	})

	// Get thread IDs for message count query
	const threadIds = useMemo(() => threads?.map((t) => t.channel.id) ?? [], [threads])

	// Get all messages in threads to count them
	const { data: threadMessages } = useLiveQuery({
		query: (q) =>
			q
				.from({ message: messageCollection })
				.where(({ message }) =>
					inArray(message.channelId, threadIds.length > 0 ? threadIds : ([""] as ChannelId[])),
				)
				.select(({ message }) => ({ channelId: message.channelId })),
		queryKey: [threadIds],
	})

	// Get user's recent messages in thread channels only to filter by activity
	const { data: recentMessages } = useLiveQuery({
		query: (q) =>
			q
				.from({ message: messageCollection })
				.where(({ message }) =>
					and(
						eq(message.authorId, userId ?? ("" as UserId)),
						gte(message.createdAt, threeDaysAgo),
						inArray(message.channelId, threadIds.length > 0 ? threadIds : ([""] as ChannelId[])),
					),
				)
				.select(({ message }) => ({ channelId: message.channelId })),
		queryKey: [userId, threeDaysAgo, threadIds],
	})

	// Filter threads to only those with recent activity, 3+ messages, and group by parent
	const threadsByParent = useMemo(() => {
		if (!threads || !recentMessages || !organizationId) return new Map<ChannelId, typeof threads>()

		const recentChannelIds = new Set(recentMessages.map((m) => m.channelId))

		// Count messages per thread
		const messageCountMap = new Map<ChannelId, number>()
		threadMessages?.forEach((m) => {
			messageCountMap.set(m.channelId, (messageCountMap.get(m.channelId) ?? 0) + 1)
		})

		const map = new Map<ChannelId, typeof threads>()

		threads
			.filter(
				(t) =>
					recentChannelIds.has(t.channel.id) &&
					t.channel.parentChannelId &&
					(messageCountMap.get(t.channel.id) ?? 0) >= 3,
			)
			.forEach((t) => {
				const parentId = t.channel.parentChannelId!
				const existing = map.get(parentId) || []
				map.set(parentId, [...existing, t])
			})

		return map
	}, [threads, recentMessages, threadMessages, organizationId])

	return { threadsByParent }
}

/**
 * Hook to resolve a bot's display name for machine users.
 * Returns the bot's name (source of truth) if the userId belongs to a bot, otherwise null.
 * Use this instead of user.firstName for machine users to avoid stale names.
 */
export const useBotName = (userId: UserId | undefined, userType: string | undefined | null) => {
	const { data } = useLiveQuery({
		query: (q) =>
			userId && userType === "machine"
				? q
						.from({ bot: botCollection })
						.where(({ bot }) => and(eq(bot.userId, userId), isNull(bot.deletedAt)))
						.select(({ bot }) => ({ name: bot.name }))
				: null,
		queryKey: [userId, userType],
	})
	return data?.[0]?.name ?? null
}

/**
 * Type for bot data with its machine user included.
 */
export type BotWithUser = Bot.Type & {
	user: User.Type
}

/**
 * Hook to fetch bots created by a specific user (for "Your Apps" page).
 * Joins bots with their machine users to get avatar data.
 */
export const useMyBots = (createdBy: UserId | undefined) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ bot: botCollection })
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ bot }) =>
					and(eq(bot.createdBy, createdBy ?? ("" as UserId)), isNull(bot.deletedAt)),
				)
				.select(({ bot, user }) => ({ ...bot, user }))
				.orderBy(({ bot }) => bot.createdAt, "desc"),
		queryKey: [createdBy],
	})

	return {
		bots: (data ?? []) as BotWithUser[],
		...rest,
	}
}

/**
 * Hook to fetch bots installed in an organization (for "Installed Apps" page).
 * Joins bots with their machine users to get avatar data.
 */
export const useInstalledBots = (organizationId: OrganizationId | undefined) => {
	const { data, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ installation: botInstallationCollection })
				.innerJoin({ bot: botCollection }, ({ installation, bot }) => eq(installation.botId, bot.id))
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ installation, bot }) =>
					and(
						eq(installation.organizationId, organizationId ?? ("" as OrganizationId)),
						isNull(bot.deletedAt),
					),
				)
				.select(({ bot, user }) => ({ ...bot, user }))
				.orderBy(({ bot }) => bot.name, "asc"),
		queryKey: [organizationId],
	})

	return {
		bots: (data ?? []) as BotWithUser[],
		...rest,
	}
}

/**
 * Hook to fetch public bots (for Marketplace page).
 * Joins bots with their machine users to get avatar data.
 * Also joins with bot installations to check if already installed.
 */
export const usePublicBots = (organizationId: OrganizationId | undefined) => {
	// Get public bots with their machine users
	const { data: botsWithUsers, ...rest } = useLiveQuery({
		query: (q) =>
			q
				.from({ bot: botCollection })
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.leftJoin({ creator: userCollection }, ({ bot, creator }) => eq(bot.createdBy, creator.id))
				.where(({ bot }) => and(eq(bot.isPublic, true), isNull(bot.deletedAt)))
				.select(({ bot, user, creator }) => ({ ...bot, user, creator }))
				.orderBy(({ bot }) => bot.installCount, "desc"),
		queryKey: [],
	})

	// Get installed bot IDs for this organization
	const { data: installations } = useLiveQuery({
		query: (q) =>
			q
				.from({ installation: botInstallationCollection })
				.where(({ installation }) =>
					eq(installation.organizationId, organizationId ?? ("" as OrganizationId)),
				)
				.select(({ installation }) => ({ botId: installation.botId })),
		queryKey: [organizationId],
	})

	// Build set of installed bot IDs
	const installedBotIds = useMemo(() => new Set((installations ?? []).map((i) => i.botId)), [installations])

	// Add isInstalled flag and creatorName to each bot
	const publicBots = useMemo(() => {
		return (botsWithUsers ?? []).map((bot) => ({
			...bot,
			isInstalled: installedBotIds.has(bot.id),
			creatorName: bot.creator
				? bot.creator.firstName && bot.creator.lastName
					? `${bot.creator.firstName} ${bot.creator.lastName}`
					: bot.creator.email
				: "Unknown",
		}))
	}, [botsWithUsers, installedBotIds])

	return {
		bots: publicBots,
		...rest,
	}
}
