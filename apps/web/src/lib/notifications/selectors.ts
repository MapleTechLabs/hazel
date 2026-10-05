import type { Notification } from "@hazel/domain/models"
import type { ChannelId, NotificationId, OrganizationMemberId } from "@hazel/schema"
import { and, eq, isNull, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { notificationCollection } from "~/db/collections"

export type NotificationLike = Pick<
	Notification.Type,
	"id" | "readAt" | "targetedResourceId" | "targetedResourceType"
>

export const isUnreadNotification = (
	notification: NotificationLike,
	optimisticReadIds?: ReadonlySet<NotificationId>,
): boolean => {
	if (optimisticReadIds?.has(notification.id)) {
		return false
	}
	return notification.readAt === null
}

export const selectUnreadCount = (
	notifications: ReadonlyArray<NotificationLike>,
	optimisticReadIds?: ReadonlySet<NotificationId>,
): number => {
	let count = 0
	for (const notification of notifications) {
		if (isUnreadNotification(notification, optimisticReadIds)) {
			count += 1
		}
	}
	return count
}

export const selectUnreadCountsByChannel = (
	notifications: ReadonlyArray<NotificationLike>,
	optimisticReadIds?: ReadonlySet<NotificationId>,
): Map<ChannelId, number> => {
	const counts = new Map<ChannelId, number>()

	for (const notification of notifications) {
		if (!isUnreadNotification(notification, optimisticReadIds)) continue
		if (notification.targetedResourceType !== "channel") continue
		if (!notification.targetedResourceId) continue

		const channelId = notification.targetedResourceId as ChannelId
		const current = counts.get(channelId) ?? 0
		counts.set(channelId, current + 1)
	}

	return counts
}

export const useNotificationUnreadCountsByChannel = (memberId: OrganizationMemberId | undefined) => {
	const { data, isLoading } = useLiveQuery({
		query: (q) =>
			memberId
				? q
						.from({ notification: notificationCollection })
						.where(({ notification }) =>
							and(eq(notification.memberId, memberId), isNull(notification.readAt)),
						)
				: null,
		queryKey: [memberId],
	})

	const unreadByChannel = useMemo(() => {
		if (!data) return new Map<ChannelId, number>()
		return selectUnreadCountsByChannel(data)
	}, [data])

	return {
		isLoading,
		unreadByChannel,
		totalUnread: data?.length ?? 0,
	}
}
