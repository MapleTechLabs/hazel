import {
	ChannelId,
	ChannelMemberId,
	MessageId,
	NotificationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"

// Channel member with notification preferences
export const ChannelMemberForNotification = Schema.Struct({
	id: ChannelMemberId,
	channelId: ChannelId,
	userId: UserId,
	isMuted: Schema.Boolean,
	notificationCount: Schema.Number,
})

export type ChannelMemberForNotification = typeof ChannelMemberForNotification.Type

// Result of getting channel members who should be notified
export const GetChannelMembersResult = Schema.Struct({
	members: Schema.Array(ChannelMemberForNotification),
	totalCount: Schema.Number,
})

export type GetChannelMembersResult = typeof GetChannelMembersResult.Type

// Result of creating a single notification
export const CreateNotificationResult = Schema.Struct({
	notificationId: NotificationId,
	memberId: OrganizationMemberId,
	createdAt: Schema.DateTimeUtc,
})

export type CreateNotificationResult = typeof CreateNotificationResult.Type

// Batch notification creation result
export const CreateNotificationsResult = Schema.Struct({
	notificationIds: Schema.Array(NotificationId),
	notifiedCount: Schema.Number,
})

export type CreateNotificationsResult = typeof CreateNotificationsResult.Type

// Error types for message activities
export class GetChannelMembersError extends Schema.TaggedError<GetChannelMembersError>()(
	"GetChannelMembersError",
	{
		channelId: ChannelId,
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true // Database errors are transient
}

export class CreateNotificationError extends Schema.TaggedError<CreateNotificationError>()(
	"CreateNotificationError",
	{
		messageId: MessageId,
		memberId: OrganizationMemberId.pipe(Schema.optional),
		userId: UserId.pipe(Schema.optional),
		message: Schema.String,
		cause: Schema.Unknown.pipe(Schema.optional),
	},
) {
	readonly retryable = true // Database errors are transient
}

// ============================================================================
// Workflow Error Union
// ============================================================================

export const MessageNotificationWorkflowError = Schema.Union([
	GetChannelMembersError,
	CreateNotificationError,
])
