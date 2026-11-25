/**
 * Unread state, kept by the channel's `OrgObject`: a channel's newest message (`channel_activity`,
 * keyed by `channelId`) and the user's own read position in it (`channel_read_state`, keyed by
 * `channelId` and `userId`, streamed to that user alone).
 */
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { JsonDate } from "./utils"

export const Schema = S.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	lastMessageId: MessageId,
	lastMessageAt: JsonDate,
	lastMessageAuthorId: UserId,
})
export type Type = typeof Schema.Type

export const ReadState = S.Struct({
	channelId: ChannelId,
	userId: UserId,
	organizationId: OrganizationId,
	lastReadAt: JsonDate,
})
export type ReadState = typeof ReadState.Type
