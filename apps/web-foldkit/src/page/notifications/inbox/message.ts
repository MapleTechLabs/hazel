import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { NotificationItem } from "./model"

export const Message = defineMessageUnion({
	UpdatedNotifications: { notifications: Schema.Array(NotificationItem) },
	ClickedNotification: { id: NotificationId },
	SucceededMarkNotificationRead: { id: NotificationId },
	FailedMarkNotificationRead: { id: NotificationId, reason: Schema.String },
})
export type Message = typeof Message.Type
