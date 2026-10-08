import type { MessageEmbed } from "@hazel/domain/models"
import { AttachmentId, MessageId } from "@hazel/schema"
import { Schema } from "effect"
import type { AttachmentInfo } from "../page/chat/lookups"
import type { ChatMessage } from "../page/chat/rows"
import { ada, channelId } from "../page/chat/channel/fixtures.test-support"

/** Message and attachment builders for chat stories and scenes (no view imports). */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const messageIdOf = (n: number) => Schema.decodeSync(MessageId)(uuid(5000 + n))
export const attachmentIdOf = (n: number) => Schema.decodeSync(AttachmentId)(uuid(8000 + n))

/** Message `n` by Ada at minute `n` of 12 March 2026; override any field. */
export const chatMessageOf = (n: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
	id: messageIdOf(n),
	channelId,
	authorId: ada,
	content: `message ${n}`,
	embeds: null,
	hasEmbeds: false,
	replyToMessageId: null,
	threadChannelId: null,
	createdAtMs: Date.UTC(2026, 2, 12, 9, n),
	updatedAtMs: null,
	isPinned: false,
	author: { firstName: "Ada", lastName: "Lovelace", avatarUrl: null, userType: "user" },
	...overrides,
})

/** An AI reply whose actor is still streaming (no cached snapshot). */
export const liveEmbeds: ReadonlyArray<MessageEmbed.MessageEmbed> = [{ liveState: { enabled: true } }]

export const imageAttachmentOf = (n: number, messageId: MessageId): AttachmentInfo => ({
	id: attachmentIdOf(n),
	messageId,
	fileName: `photo-${n}.png`,
	fileSize: 1024,
	url: `https://cdn.hazel.sh/photo-${n}.png`,
	uploadedAtMs: 0,
})
