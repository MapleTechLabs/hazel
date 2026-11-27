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
} from "@hazel/schema"
import type { Collections } from "./collections"

export const makeRoutingHints = (collections: Collections) => {
	const {
		channelCollection,
		channelMemberCollection,
		channelSectionCollection,
		chatSyncChannelLinkCollection,
		chatSyncConnectionCollection,
		customEmojiCollection,
		messageCollection,
		organizationMemberCollection,
		pinnedMessageCollection,
	} = collections

	const channelOfMessage = (id: MessageId) => messageCollection.get(id)?.channelId
	const channelOfPin = (id: PinnedMessageId) => pinnedMessageCollection.get(id)?.channelId

	const orgOfChannel = (id: ChannelId | undefined) =>
		id === undefined ? undefined : channelCollection.get(id)?.organizationId
	const orgOfChannelMember = (id: ChannelMemberId) =>
		orgOfChannel(channelMemberCollection.get(id)?.channelId)
	const orgOfMember = (id: OrganizationMemberId) => organizationMemberCollection.get(id)?.organizationId
	const orgOfSection = (id: ChannelSectionId) => channelSectionCollection.get(id)?.organizationId
	const orgOfEmoji = (id: CustomEmojiId) => customEmojiCollection.get(id)?.organizationId
	const orgOfChatSyncConnection = (id: SyncConnectionId) =>
		chatSyncConnectionCollection.get(id)?.organizationId
	const orgOfChatSyncChannelLink = (id: SyncChannelLinkId) => {
		const link = chatSyncChannelLinkCollection.get(id)
		return link === undefined ? undefined : orgOfChatSyncConnection(link.syncConnectionId)
	}

	return {
		channelOfMessage,
		channelOfPin,
		orgOfChannel,
		orgOfChannelMember,
		orgOfMember,
		orgOfSection,
		orgOfEmoji,
		orgOfChatSyncConnection,
		orgOfChatSyncChannelLink,
	}
}

export type RoutingHints = ReturnType<typeof makeRoutingHints>
