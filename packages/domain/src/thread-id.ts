import { ChannelId, type MessageId } from "@hazel/schema"

/**
 * The id a thread on `messageId` gets when its creator names none (`channel.createThread`): derived
 * from the message, so a retried or racing create answers with the same thread instead of opening
 * another. The first 16 bytes of a SHA-256, shaped as an RFC 4122 v4 UUID.
 */
export const derivedThreadChannelId = async (messageId: MessageId): Promise<ChannelId> => {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hazel.thread:${messageId}`)),
	)
	digest[6] = (digest[6]! & 0x0f) | 0x40
	digest[8] = (digest[8]! & 0x3f) | 0x80
	const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")
	return ChannelId.make(
		`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
	)
}
