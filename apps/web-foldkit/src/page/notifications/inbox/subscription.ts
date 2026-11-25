import type { ChannelId, NotificationId } from "@hazel/schema"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import { type UnreadChannelMutes, unreadMuteEnd } from "~/lib/unread"
import {
	channelActivityCollection,
	channelCollection,
	channelMemberCollection,
	channelReadStateCollection,
	messageCollection,
	notificationCollection,
	notificationOverrideCollection,
	organizationCollection,
	userCollection,
} from "~/db/collections"
import { liveQueryStream, retainChannels } from "../../../data/live-query"
import type { PageSubscriptionInput } from "../../contract"
import { Message } from "./message"
import type { Model, NotificationItem, UnreadChannelItem } from "./model"

/** A row of the legacy join; the collections decode with the domain schemas, so ids are branded. */
interface NotificationRow {
	readonly notification: {
		readonly id: NotificationId
		readonly targetedResourceId: string | null
		readonly targetedResourceType: string | null
		readonly resourceType: string | null
		readonly reason?: string | null
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
	reason: row.notification.reason ?? null,
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

export interface UnreadChannelRow extends UnreadChannelMutes {
	readonly channelId: ChannelId
	readonly name: string
	readonly notificationCount: number
}

/**
 * The Unreads tab: the user's channels with someone else's message after their read position
 * (`~/lib/unread`), the join of the sidebar's `unreadChannelsStream` with each channel's name and
 * the member's mention count, with the same mute rules (`unreadMuteEnd`); a timed mute is left to
 * the view's clock.
 */
export const unreadChannelsStream = (organizationId: OrganizationId, userId: UserId) =>
	liveQueryStream<UnreadChannelRow, Message>(
		(q) =>
			q
				.from({ member: channelMemberCollection })
				.innerJoin({ activity: channelActivityCollection }, ({ member, activity }) =>
					eq(activity.channelId, member.channelId),
				)
				.innerJoin({ channel: channelCollection }, ({ member, channel }) =>
					eq(channel.id, member.channelId),
				)
				.innerJoin({ organization: organizationCollection }, ({ activity, organization }) =>
					eq(organization.id, activity.organizationId),
				)
				// Only the user's own read positions and settings are synced.
				.leftJoin({ read: channelReadStateCollection }, ({ member, read }) =>
					eq(read.channelId, member.channelId),
				)
				.leftJoin({ section: notificationOverrideCollection }, ({ channel, section }) =>
					eq(section.scopeId, channel.sectionId),
				)
				.leftJoin({ org: notificationOverrideCollection }, ({ activity, org }) =>
					eq(org.scopeId, activity.organizationId),
				)
				.where((q) =>
					and(
						eq(q.activity.organizationId, organizationId),
						eq(q.member.userId, userId),
						eq(q.member.isMuted, false),
						isNull(q.member.deletedAt),
						isNull(q.channel.deletedAt),
					),
				)
				.select(({ member, activity, channel, organization, read, section, org }) => ({
					channelId: member.channelId,
					name: channel.name,
					type: channel.type,
					notificationCount: member.notificationCount,
					isMuted: member.isMuted,
					mutedUntil: member.mutedUntil,
					joinedAt: member.joinedAt,
					lastReadAt: read?.lastReadAt,
					readStateSince: organization.readStateSince,
					lastMessageAt: activity.lastMessageAt,
					lastMessageAuthorId: activity.lastMessageAuthorId,
					sectionMuted: section?.isMuted,
					sectionMutedUntil: section?.mutedUntil,
					orgMuted: org?.isMuted,
					orgMutedUntil: org?.mutedUntil,
				})),
		(rows) => Message.UpdatedUnreadChannels({ channels: toUnreadChannels(rows, userId) }),
	)

/** The rows the user has not read, as Unreads items (the view sorts them). */
export const toUnreadChannels = (
	rows: ReadonlyArray<UnreadChannelRow>,
	userId: UserId,
): Array<UnreadChannelItem> =>
	rows.flatMap((row) => {
		const unread = unreadMuteEnd(row, userId)
		return unread === undefined
			? []
			: [
					{
						channelId: row.channelId,
						name: row.name,
						type: row.type,
						mentionCount: row.notificationCount,
						lastMessageAtMs: new Date(row.lastMessageAt).getTime(),
						mutedUntilMs: unread.mutedUntilMs,
					},
				]
	})

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
	unreadChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.organization?.id ?? null,
				userId: shared.currentUser?.id ?? null,
			}),
			dependenciesToStream: ({ organizationId, userId }) =>
				organizationId === null || userId === null
					? Stream.empty
					: unreadChannelsStream(organizationId, userId),
		},
	),
}))
