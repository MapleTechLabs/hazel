import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { MarkChannelReadFailure, MarkReadFailure, NotificationItem, UnreadChannelItem } from "./model"

export const Message = defineMessageUnion({
	UpdatedNotifications: { notifications: Schema.Array(NotificationItem) },
	UpdatedUnreadChannels: { channels: Schema.Array(UnreadChannelItem) },
	/** The row itself: it opens the message, and an unread notification is marked read on the way. */
	ClickedNotification: { id: NotificationId },
	/** The row's "Mark as read" action. */
	ClickedMarkNotificationRead: { id: NotificationId },
	SucceededMarkNotificationRead: { id: NotificationId },
	FailedMarkNotificationRead: { id: NotificationId, reason: MarkReadFailure },
	/** An Unreads row's "Mark as read" action. */
	ClickedMarkChannelRead: { channelId: ChannelId },
	SucceededMarkChannelRead: { channelId: ChannelId },
	FailedMarkChannelRead: { channelId: ChannelId, reason: MarkChannelReadFailure },
	/** The Unreads header's "Mark all as read". */
	ClickedMarkAllChannelsRead: {},
	SucceededMarkAllChannelsRead: {},
	FailedMarkAllChannelsRead: { channelIds: Schema.Array(ChannelId), reason: CommonReason },
})
export type Message = typeof Message.Type
