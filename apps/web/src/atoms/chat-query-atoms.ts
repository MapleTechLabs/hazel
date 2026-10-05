import { Atom } from "effect/reactivity"
import type { Message, PinnedMessage, User } from "@hazel/domain/models"
import type { ChannelId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { channelCollection } from "~/db/collections"
import { makeQuery } from "../../../../libs/tanstack-db-atom/src"

export type MessageWithPinned = Message.Type & {
	pinnedMessage: PinnedMessage.Type | null | undefined
	author: User.Type | null | undefined
	isSyncedFromDiscord?: boolean
}

export type ProcessedMessage = {
	message: MessageWithPinned
	isGroupStart: boolean
	isGroupEnd: boolean
	isFirstNewMessage: boolean
	isPinned: boolean
}

/**
 * Atom family for fetching a channel by ID
 * Returns the channel as an array (matching TanStack DB query results)
 */
export const channelByIdAtomFamily = Atom.family((channelId: ChannelId) =>
	makeQuery((q) =>
		q
			.from({ channel: channelCollection })
			.where(({ channel }) => eq(channel.id, channelId))
			.orderBy(({ channel }) => channel.createdAt, "desc")
			.findOne(),
	),
)
