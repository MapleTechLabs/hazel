import type { Channel, Message, Notification, User } from "@hazel/domain/models"

export type NotificationDeliveryReason =
	| "ok"
	| "duplicate"
	| "before_session_start"
	| "muted"
	| "silent"
	| "focused_current_channel"
	| "focused_window"
	| "not_ready"
	| "cooldown"
	| "permission_denied"
	| "api_unavailable"
	| "error"

export type NotificationSinkName = "sound" | "native"

export type NotificationSinkStatus = "sent" | "suppressed" | "failed"

export interface NotificationSinkResult {
	sink: NotificationSinkName
	status: NotificationSinkStatus
	reason: NotificationDeliveryReason
	error?: unknown
}

export interface NotificationEvent {
	id: string
	notification: Notification.Type
	message?: Message.Type
	author?: User.Type
	channel?: Channel.Type
	receivedAt: number
}

export interface NotificationDecision {
	eventId: string
	playSound: boolean
	sendNative: boolean
	reasons: NotificationDeliveryReason[]
}

export interface NotificationDecisionContext {
	currentChannelId: string | null
	sessionStartTime: Date
	isMuted: boolean
	isWindowFocused: boolean
	visibilityState: DocumentVisibilityState
	now: number
}

export interface NotificationProcessingRecord {
	eventId: string
	notificationId: string
	startedAt: number
	finishedAt: number
	durationMs: number
	decision: NotificationDecision
	results: NotificationSinkResult[]
}

export interface NotificationSink {
	handle(event: NotificationEvent, decision: NotificationDecision): Promise<NotificationSinkResult>
}
