/**
 * Routing hints (`@hazel/domain/rpc/routing-fields`): the api Worker routes a call naming a row
 * only by id to the object owning it, so the client names that object. Read from the synced rows;
 * `undefined` when the row is not loaded (the call then fails with a routing error).
 */
import type {
	ChannelId,
	ChannelMemberId,
	ChannelSectionId,
	CustomEmojiId,
	MessageId,
	OrganizationMemberId,
	PinnedMessageId,
	SyncChannelLinkId,
	SyncConnectionId,
	TypingIndicatorId,
} from "@hazel/schema"
import {
	channelCollection,
	channelMemberCollection,
	channelSectionCollection,
	chatSyncChannelLinkCollection,
	chatSyncConnectionCollection,
	customEmojiCollection,
	messageCollection,
	organizationMemberCollection,
	pinnedMessageCollection,
	typingIndicatorCollection,
} from "./collections"

export const channelOfMessage = (id: MessageId) => messageCollection.get(id)?.channelId
export const channelOfPin = (id: PinnedMessageId) => pinnedMessageCollection.get(id)?.channelId
export const channelOfTypingIndicator = (id: TypingIndicatorId) =>
	typingIndicatorCollection.get(id)?.channelId

export const orgOfChannel = (id: ChannelId | undefined) =>
	id === undefined ? undefined : channelCollection.get(id)?.organizationId
export const orgOfChannelMember = (id: ChannelMemberId) =>
	orgOfChannel(channelMemberCollection.get(id)?.channelId)
export const orgOfMember = (id: OrganizationMemberId) => organizationMemberCollection.get(id)?.organizationId
export const orgOfSection = (id: ChannelSectionId) => channelSectionCollection.get(id)?.organizationId
export const orgOfEmoji = (id: CustomEmojiId) => customEmojiCollection.get(id)?.organizationId
export const orgOfChatSyncConnection = (id: SyncConnectionId) =>
	chatSyncConnectionCollection.get(id)?.organizationId
export const orgOfChatSyncChannelLink = (id: SyncChannelLinkId) => {
	const link = chatSyncChannelLinkCollection.get(id)
	return link === undefined ? undefined : orgOfChatSyncConnection(link.syncConnectionId)
}
