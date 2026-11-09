import { Message } from "@hazel/domain/models"
import type { AttachmentId, ChannelId, ConnectConversationId, MessageId, UserId } from "@hazel/schema"

export interface SendMessageVariables {
	readonly channelId: ChannelId
	readonly authorId: UserId
	readonly content: string
	readonly replyToMessageId?: MessageId | null
	readonly threadChannelId?: ChannelId | null
	readonly attachmentIds?: ReadonlyArray<AttachmentId>
}

/**
 * One send's optimistic row and `message.create` payload, from one nonce: the server derives the
 * row's id from the payload's `clientNonce`, so the synced row replaces the optimistic one in place.
 */
export const prepareSend = (
	variables: SendMessageVariables,
	conversationId: ConnectConversationId | null,
	clientNonce: string = crypto.randomUUID(),
) => {
	const replyToMessageId = variables.replyToMessageId ?? null
	const threadChannelId = variables.threadChannelId ?? null
	return {
		row: {
			id: Message.clientMessageId(variables.channelId, variables.authorId, clientNonce),
			channelId: variables.channelId,
			conversationId,
			authorId: variables.authorId,
			content: variables.content,
			replyToMessageId,
			threadChannelId,
			embeds: null,
			createdAt: new Date(),
			updatedAt: null,
			deletedAt: null,
		},
		// The backend's auth middleware replaces `authorId` with the signed-in user.
		payload: {
			clientNonce,
			channelId: variables.channelId,
			content: variables.content,
			replyToMessageId,
			threadChannelId,
			attachmentIds: [...(variables.attachmentIds ?? [])],
			embeds: null,
			deletedAt: null,
			authorId: variables.authorId,
		},
	}
}
