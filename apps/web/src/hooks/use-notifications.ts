import type { Channel, Message, Notification, User } from "@hazel/domain/models"
import type { ChannelId, NotificationId } from "@hazel/schema"
import { and, eq, isNull, useLiveQuery } from "@tanstack/react-db"
import { Effect } from "effect"
import { useCallback, useMemo, useState } from "react"
import {
	channelCollection,
	messageCollection,
	notificationCollection,
	organizationMemberCollection,
	userCollection,
} from "~/db/collections"
import { useAuth } from "~/lib/auth"
import {
	isUnreadNotification,
	selectUnreadCount,
	selectUnreadCountsByChannel,
	useNotificationUnreadCountsByChannel,
} from "~/lib/notifications"
import { HazelRpcClient } from "~/lib/services/common/rpc-atom-client"
import { runtime } from "~/lib/services/common/runtime"
import { useOrganization } from "./use-organization"

function useOrganizationMember() {
	const { user } = useAuth()
	const { organizationId } = useOrganization()

	const { data, isLoading } = useLiveQuery({
		query: (q) =>
			user?.id && organizationId
				? q
						.from({ member: organizationMemberCollection })
						.where(({ member }) =>
							and(eq(member.userId, user.id), eq(member.organizationId, organizationId)),
						)
						.findOne()
				: null,
		queryKey: [user?.id, organizationId],
	})

	return { member: data, memberId: data?.id, isLoading }
}

export interface NotificationWithDetails {
	notification: Notification.Type
	message?: Message.Type
	channel?: Channel.Type
	author?: User.Type
}

export function useNotifications() {
	const { memberId, isLoading: memberLoading } = useOrganizationMember()
	const [optimisticReadIds, setOptimisticReadIds] = useState<Set<NotificationId>>(new Set())

	const { data: notificationsData, isLoading: notificationsLoading } = useLiveQuery({
		query: (q) =>
			memberId
				? q
						.from({ notification: notificationCollection })
						.leftJoin({ message: messageCollection }, ({ notification, message }) =>
							eq(notification.resourceId, message.id),
						)
						.leftJoin({ channel: channelCollection }, ({ notification, channel }) =>
							eq(notification.targetedResourceId, channel.id),
						)
						.leftJoin({ author: userCollection }, ({ message, author }) =>
							eq(message!.authorId, author.id),
						)
						.where(({ notification }) => eq(notification.memberId, memberId))
						.orderBy(({ notification }) => notification.createdAt, "desc")
				: null,
		queryKey: [memberId],
	})

	const notifications = useMemo<NotificationWithDetails[]>(() => {
		if (!notificationsData) return []

		return notificationsData.map((row) => ({
			notification: row.notification as Notification.Type,
			message: (row.message ?? undefined) as Message.Type | undefined,
			channel: (row.channel ?? undefined) as Channel.Type | undefined,
			author: (row.author ?? undefined) as User.Type | undefined,
		}))
	}, [notificationsData])

	const unreadCount = useMemo(() => {
		return selectUnreadCount(
			notifications.map((n) => n.notification),
			optimisticReadIds,
		)
	}, [notifications, optimisticReadIds])

	const unreadByChannel = useMemo(() => {
		return selectUnreadCountsByChannel(
			notifications.map((n) => n.notification),
			optimisticReadIds,
		)
	}, [notifications, optimisticReadIds])

	const markAsRead = useCallback(async (notificationId: NotificationId) => {
		setOptimisticReadIds((prev) => {
			const next = new Set(prev)
			next.add(notificationId)
			return next
		})

		const program = Effect.gen(function* () {
			const client = yield* HazelRpcClient
			yield* client("notification.update", {
				id: notificationId,
				readAt: new Date(),
			} as any)
		})

		await runtime.runPromise(program).catch(() => {
			setOptimisticReadIds((prev) => {
				const next = new Set(prev)
				next.delete(notificationId)
				return next
			})
		})
	}, [])

	const markAllAsRead = useCallback(async () => {
		const unreadNotificationIds = notifications
			.map((item) => item.notification)
			.filter((notification) => isUnreadNotification(notification, optimisticReadIds))
			.map((notification) => notification.id)

		if (unreadNotificationIds.length === 0) return

		setOptimisticReadIds((prev) => {
			const next = new Set(prev)
			for (const id of unreadNotificationIds) {
				next.add(id)
			}
			return next
		})

		await Promise.all(unreadNotificationIds.map((id) => markAsRead(id)))
	}, [notifications, optimisticReadIds, markAsRead])

	return {
		notifications,
		unreadCount,
		unreadByChannel,
		isLoading: memberLoading || notificationsLoading,
		markAsRead,
		markAllAsRead,
		memberId,
	}
}

export function useUnreadNotificationCount() {
	const { memberId, isLoading: memberLoading } = useOrganizationMember()

	const { data: notifications, isLoading: notificationsLoading } = useLiveQuery({
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

	return {
		unreadCount: notifications?.length ?? 0,
		isLoading: memberLoading || notificationsLoading,
	}
}

export function useChannelUnreadCount(channelId: ChannelId | null | undefined) {
	const { memberId } = useOrganizationMember()
	const { unreadByChannel, totalUnread, isLoading } = useNotificationUnreadCountsByChannel(memberId)

	const unreadCount = channelId ? (unreadByChannel.get(channelId) ?? 0) : 0

	return {
		unreadCount,
		totalUnread,
		isLoading,
	}
}

export function useChannelUnreadCountMap() {
	const { memberId } = useOrganizationMember()
	return useNotificationUnreadCountsByChannel(memberId)
}
