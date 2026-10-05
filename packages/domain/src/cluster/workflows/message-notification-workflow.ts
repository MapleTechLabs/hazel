import { Workflow } from "effect/workflow"
import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { ChannelType } from "../../models/channel-model.ts"
import { MessageNotificationWorkflowError } from "../activities/message-activities.ts"

// Message notification workflow - triggered when a new message is created
// Notifies channel members based on channel type and mentions:
// - DM/group chats: notify all members
// - Regular channels: only notify mentioned users or reply-to authors
export const MessageNotificationWorkflow = Workflow.make("MessageNotificationWorkflow", {
	payload: {
		messageId: MessageId,
		channelId: ChannelId,
		authorId: UserId,
		channelType: ChannelType,
		content: Schema.String,
		replyToMessageId: Schema.NullOr(MessageId),
	},
	error: MessageNotificationWorkflowError,
	// Process each message only once
	idempotencyKey: (payload) => payload.messageId,
})

export type MessageNotificationWorkflowPayload = Schema.Schema.Type<
	typeof MessageNotificationWorkflow.payloadSchema
>
