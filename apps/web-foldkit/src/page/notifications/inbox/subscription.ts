import type { NotificationId } from "@hazel/schema"
import { OrganizationMemberId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	channelCollection,
	messageCollection,
	notificationCollection,
	userCollection,
} from "~/db/collections"
import { liveQueryStream, retainChannels } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model, NotificationItem } from "./model"

/** A row of the legacy join; the collections decode with the domain schemas, so ids are branded. */
interface NotificationRow {
	readonly notification: {
		readonly id: NotificationId
		readonly targetedResourceId: string | null
		readonly targetedResourceType: string | null
		readonly resourceType: string | null
		readonly createdAt: Date
		readonly readAt: Date | null
	}
	readonly message?: { readonly content?: string | null } | null
	readonly channel?: { readonly name: string; readonly type: string } | null
	readonly author?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	} | null
}

const toItem = (row: NotificationRow): NotificationItem => ({
	id: row.notification.id,
	isUnread: row.notification.readAt === null,
	createdAtMs: new Date(row.notification.createdAt).getTime(),
	resourceType: row.notification.resourceType,
	targetedResourceId: row.notification.targetedResourceId,
	targetedResourceType: row.notification.targetedResourceType,
	messageContent: row.message?.content ?? null,
	channel: row.channel ? { name: row.channel.name, type: row.channel.type } : null,
	author: row.author
		? {
				firstName: row.author.firstName,
				lastName: row.author.lastName,
				avatarUrl: row.author.avatarUrl ?? null,
			}
		: null,
})

/** Channels the inbox opens for its message previews: those of the newest notifications. */
const MAX_PREVIEW_CHANNELS = 25

/**
 * The channels of the member's notifications, held open so the message join finds its rows
 * (messages sync per channel, and a join on `resourceId` names none).
 */
const notificationChannelIds = (memberId: OrganizationMemberId) =>
	liveQueryStream<{ readonly channelId: string | null }, ReadonlyArray<string>>(
		(q) =>
			q
				.from({ notification: notificationCollection })
				.where(({ notification }) => eq(notification.memberId, memberId))
				.where(({ notification }) => eq(notification.targetedResourceType, "channel"))
				.orderBy(({ notification }) => notification.createdAt, "desc")
				.select(({ notification }) => ({ channelId: notification.targetedResourceId })),
		(rows) =>
			[...new Set(rows.flatMap((row) => (row.channelId === null ? [] : [row.channelId])))].slice(
				0,
				MAX_PREVIEW_CHANNELS,
			),
	).pipe(
		Stream.changesWith((a, b) => a.length === b.length && a.every((id, index) => id === b[index])),
		Stream.switchMap(retainChannels),
	)

export const subscriptions = Subscription.make<PageSubscriptionInput<Model>, Message>()((entry) => ({
	notifications: entry(
		{ memberId: Schema.NullOr(OrganizationMemberId) },
		{
			modelToDependencies: ({ shared }) => ({ memberId: shared.member?.id ?? null }),
			dependenciesToStream: ({ memberId }) =>
				memberId === null
					? Stream.empty
					: Stream.merge(
							notificationChannelIds(memberId),
							liveQueryStream<NotificationRow, Message>(
								// Same query as `useNotifications` (`hooks/use-notifications.ts`).
								(q) =>
									q
										.from({ notification: notificationCollection })
										.leftJoin(
											{ message: messageCollection },
											({ notification, message }) =>
												eq(notification.resourceId, message.id),
										)
										.leftJoin(
											{ channel: channelCollection },
											({ notification, channel }) =>
												eq(notification.targetedResourceId, channel.id),
										)
										.leftJoin({ author: userCollection }, ({ message, author }) =>
											eq(message!.authorId, author.id),
										)
										.where(({ notification }) => eq(notification.memberId, memberId))
										.orderBy(({ notification }) => notification.createdAt, "desc"),
								(rows) => Message.UpdatedNotifications({ notifications: rows.map(toItem) }),
							),
						),
		},
	),
}))
