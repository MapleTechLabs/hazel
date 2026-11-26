import type { ChannelId, ConnectConversationId } from "@hazel/schema"
import type { DateTime } from "effect"

type ConnectMountLike = {
	channelId: ChannelId
	conversationId: ConnectConversationId
	isActive: boolean
	deletedAt: Date | DateTime.Utc | null
}

const isActiveMount = (mount: ConnectMountLike) => mount.isActive && mount.deletedAt === null

const getSharedConversationIds = (mounts: Iterable<ConnectMountLike>) => {
	const counts = new Map<ConnectConversationId, number>()

	for (const mount of mounts) {
		if (!isActiveMount(mount)) continue
		counts.set(mount.conversationId, (counts.get(mount.conversationId) ?? 0) + 1)
	}

	return new Set(
		Array.from(counts.entries())
			.filter(([, count]) => count > 1)
			.map(([conversationId]) => conversationId),
	)
}

export const getSharedConversationIdForChannel = (
	channelId: ChannelId,
	mounts: Iterable<ConnectMountLike>,
): ConnectConversationId | null => {
	const sharedConversationIds = getSharedConversationIds(mounts)

	for (const mount of mounts) {
		if (!isActiveMount(mount)) continue
		if (mount.channelId === channelId && sharedConversationIds.has(mount.conversationId)) {
			return mount.conversationId
		}
	}

	return null
}

export const getSharedChannelIds = (mounts: Iterable<ConnectMountLike>) => {
	const sharedConversationIds = getSharedConversationIds(mounts)
	const result = new Set<ChannelId>()

	for (const mount of mounts) {
		if (isActiveMount(mount) && sharedConversationIds.has(mount.conversationId)) {
			result.add(mount.channelId)
		}
	}

	return result
}

export const getSharedConversationMountsForChannel = <TMount extends ConnectMountLike>(
	channelId: ChannelId,
	mounts: readonly TMount[],
): TMount[] => {
	const conversationId = getSharedConversationIdForChannel(channelId, mounts)
	if (!conversationId) return []

	return mounts.filter((mount) => isActiveMount(mount) && mount.conversationId === conversationId)
}

export const connectInviteStatusBadge = {
	pending: { intent: "warning" as const, label: "Pending" },
	accepted: { intent: "success" as const, label: "Accepted" },
	declined: { intent: "secondary" as const, label: "Declined" },
	revoked: { intent: "secondary" as const, label: "Revoked" },
	expired: { intent: "secondary" as const, label: "Expired" },
} as const

export const getConnectInviteStatusBadge = (status: string) =>
	connectInviteStatusBadge[status as keyof typeof connectInviteStatusBadge] ?? {
		intent: "secondary" as const,
		label: status,
	}
