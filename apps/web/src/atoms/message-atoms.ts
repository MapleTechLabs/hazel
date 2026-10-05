import { Atom, AsyncResult } from "effect/reactivity"
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { and, count, eq, isNull } from "@tanstack/db"
import {
	chatSyncChannelLinkCollection,
	chatSyncConnectionCollection,
	chatSyncMessageLinkCollection,
	messageCollection,
	messageReactionCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { makeQuery } from "../../../../libs/tanstack-db-atom/src"

/**
 * Atom family for fetching reactions for a specific message
 * Automatically deduplicates - if multiple MessageItems show the same message,
 * only one query is executed
 */
export const messageReactionsAtomFamily = Atom.family((messageId: MessageId) =>
	makeQuery((q) =>
		q.from({ reactions: messageReactionCollection }).where((q) => eq(q.reactions.messageId, messageId)),
	),
)

/**
 * Derived atom that processes raw reactions into aggregated format
 * Computation is memoized and only runs when reactions change
 *
 * Uses string key format `${messageId}:${currentUserId}` to prevent
 * atom re-subscription from object key reference changes
 */
export const processedReactionsAtomFamily = Atom.family((key: `${MessageId}:${string}`) =>
	Atom.make((get) => {
		const [messageId] = key.split(":") as [MessageId, string]
		const currentUserId = key.slice(messageId.length + 1) // Handle userId that may contain ":"
		const reactionsResult = get(messageReactionsAtomFamily(messageId))
		const reactions = AsyncResult.getOrElse(reactionsResult, () => [])

		// Aggregate reactions by emoji
		return Object.entries(
			reactions.reduce(
				(acc, reaction) => {
					if (!acc[reaction.emoji]) {
						acc[reaction.emoji] = {
							count: 0,
							users: [],
							hasReacted: false,
						}
					}
					acc[reaction.emoji]!.count++
					acc[reaction.emoji]!.users.push(reaction.userId)
					if (reaction.userId === currentUserId) {
						acc[reaction.emoji]!.hasReacted = true
					}
					return acc
				},
				{} as Record<string, { count: number; users: string[]; hasReacted: boolean }>,
			),
		)
	}),
)

/**
 * Atom family for fetching user data with presence status
 * Automatically deduplicates - if the same user appears in multiple messages,
 * only one query is executed and the result is shared
 */
export const userWithPresenceAtomFamily = Atom.family((userId: UserId) =>
	makeQuery((q) =>
		q
			.from({ user: userCollection })
			.leftJoin({ presence: userPresenceStatusCollection }, ({ user, presence }) =>
				eq(user.id, presence.userId),
			)
			.where((q) => eq(q.user.id, userId))
			.select(({ user, presence }) => ({ user, presence })),
	),
)

/**
 * Atom family for fetching a message with its author
 * Used primarily for reply sections
 */
export const messageWithAuthorAtomFamily = Atom.family((messageId: MessageId) =>
	makeQuery((q) =>
		q
			.from({ message: messageCollection })
			.innerJoin({ author: userCollection }, ({ message, author }) => eq(message.authorId, author.id))
			.where((q) => eq(q.message.id, messageId))
			.findOne()
			.select(({ message, author }) => ({ ...message, author: author }))
			.orderBy((q) => q.message.createdAt, "desc"),
	),
)

/**
 * Atom family to check whether a Hazel message originated from Discord external->Hazel sync.
 */
export const isDiscordSyncedMessageAtomFamily = Atom.family((messageId: MessageId) =>
	makeQuery((q) =>
		q
			.from({ messageLink: chatSyncMessageLinkCollection })
			.innerJoin({ channelLink: chatSyncChannelLinkCollection }, ({ messageLink, channelLink }) =>
				eq(messageLink.channelLinkId, channelLink.id),
			)
			.innerJoin({ connection: chatSyncConnectionCollection }, ({ channelLink, connection }) =>
				eq(channelLink.syncConnectionId, connection.id),
			)
			.where(({ messageLink, channelLink, connection }) =>
				and(
					eq(messageLink.hazelMessageId, messageId),
					eq(messageLink.source, "external"),
					eq(connection.provider, "discord"),
					isNull(messageLink.deletedAt),
					isNull(channelLink.deletedAt),
					isNull(connection.deletedAt),
				),
			)
			.orderBy(({ messageLink }) => messageLink.createdAt, "desc")
			.limit(1),
	),
)

/**
 * Atom family for fetching thread messages by channel ID
 * Returns messages in chronological order
 */
export const threadMessagesAtomFamily = Atom.family(
	({ threadChannelId, maxPreviewMessages }: { threadChannelId: ChannelId; maxPreviewMessages: number }) =>
		makeQuery(
			(q) =>
				q
					.from({ message: messageCollection })
					.where(({ message }) => eq(message.channelId, threadChannelId))
					.orderBy(({ message }) => message.createdAt, "asc")
					.limit(maxPreviewMessages + 1), // Fetch one extra to check if there are more
		),
)

/**
 * Atom family for counting total messages in a thread
 */
export const threadMessageCountAtomFamily = Atom.family((threadChannelId: ChannelId) =>
	makeQuery((q) =>
		q
			.from({ message: messageCollection })
			.where(({ message }) => eq(message.channelId, threadChannelId))
			.select(({ message }) => ({
				count: count(message.id),
			})),
	),
)

/**
 * Atom family for fetching thread messages with their authors
 * Returns messages in chronological order with author data joined
 * Used by ThreadMessageItem to display full message features
 */
export const threadMessagesWithAuthorAtomFamily = Atom.family(
	({ threadChannelId }: { threadChannelId: ChannelId }) =>
		makeQuery((q) =>
			q
				.from({ message: messageCollection })
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.where(({ message }) => eq(message.channelId, threadChannelId))
				.select(({ message, author }) => ({
					...message,
					author,
					pinnedMessage: null,
				}))
				.orderBy(({ message }) => message.createdAt, "asc"),
		),
)
