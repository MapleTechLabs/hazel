import {
	type AttachmentId,
	type OrganizationMemberId,
	type ChannelIcon,
	ChannelId,
	ChannelMemberId,
	ChannelSectionId,
	CustomEmojiId,
	MessageId,
	MessageReactionId,
	OrganizationId,
	PinnedMessageId,
	type UserId,
} from "@hazel/schema"
import { Effect, Schedule, Duration } from "effect"
import { isRetryableError } from "~/lib/error-messages"
import { getSharedConversationIdForChannel } from "~/lib/connect-shared-channels"
import { optimisticAction } from "@hazel/effect-db-collection"
import { HazelRpc } from "../../rpc"
import {
	channelOfMessage,
	channelOfPin,
	orgOfChannelMember,
	orgOfEmoji,
	orgOfMember,
	orgOfSection,
} from "./routing-hints"
import {
	attachmentCollection,
	channelCollection,
	channelMemberCollection,
	channelSectionCollection,
	connectConversationChannelCollection,
	customEmojiCollection,
	messageCollection,
	messageReactionCollection,
	organizationCollection,
	organizationMemberCollection,
	pinnedMessageCollection,
} from "./collections"

/**
 * The optimistic actions: each is `(variables) => Effect` that applies the change to the collections at once,
 * runs the RPC through `HazelRpc`, waits until the write's source streamed it (`awaitSeqEffect` on the
 * returned `<kind>:<id>:<seq>`), and rolls back on failure.
 */

const getMountedConversationId = (channelId: ChannelId) =>
	getSharedConversationIdForChannel(channelId, connectConversationChannelCollection.state.values())

/**
 * Retry schedule for message sending:
 * - Base delay: 1 second
 * - Exponential backoff: 1s, 2s, 4s
 * - Jittered to prevent thundering herd
 * - Only retries retryable errors (transient failures)
 * - Maximum 3 attempts
 */
const MessageRetrySchedule = Schedule.exponential(Duration.seconds(1), 2).pipe(
	Schedule.jittered,
	Schedule.while((metadata) => isRetryableError(metadata.input)),
	(schedule) => Schedule.max([schedule, Schedule.recurs(3)]),
)

export const sendMessageAction = optimisticAction({
	// The channel's one stream carries the attachments too; one wait confirms both.
	collections: [messageCollection],

	onMutate: (props: {
		messageId?: MessageId // Accept pre-generated ID for retry tracking
		channelId: ChannelId
		authorId: UserId
		content: string
		replyToMessageId?: MessageId | null
		threadChannelId?: ChannelId | null
		attachmentIds?: AttachmentId[]
	}) => {
		const messageId = props.messageId ?? MessageId.make(crypto.randomUUID())

		messageCollection.insert({
			id: messageId,
			channelId: props.channelId,
			conversationId: getMountedConversationId(props.channelId),
			authorId: props.authorId,
			content: props.content,
			replyToMessageId: props.replyToMessageId || null,
			threadChannelId: props.threadChannelId || null,
			embeds: null,
			createdAt: new Date(),
			updatedAt: null,
			deletedAt: null,
		})

		// Optimistically link attachments to the new message
		if (props.attachmentIds && props.attachmentIds.length > 0) {
			for (const attachmentId of props.attachmentIds) {
				attachmentCollection.update(attachmentId, (attachment) => {
					attachment.messageId = messageId
				})
			}
		}

		return { messageId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc

			// Create the message with attachmentIds using RPC
			// Note: authorId will be overridden by backend AuthMiddleware with the authenticated user
			const result = yield* client("message.create", {
				channelId: props.channelId,
				content: props.content,
				replyToMessageId: props.replyToMessageId || null,
				threadChannelId: props.threadChannelId || null,
				attachmentIds: props.attachmentIds || [],
				embeds: null,
				deletedAt: null,
				authorId: props.authorId,
			}).pipe(Effect.retry(MessageRetrySchedule))

			return { data: result, transactionId: result.transactionId }
		}),
})

export const createChannelAction = optimisticAction({
	collections: {
		channel: channelCollection,
		members: channelMemberCollection,
	},
	onMutate: (props: {
		organizationId: OrganizationId
		name: string
		icon?: string | null
		type: "public" | "private" | "thread"
		parentChannelId: ChannelId | null
		currentUserId: UserId
		addAllMembers?: boolean
	}) => {
		const channelId = ChannelId.make(crypto.randomUUID())
		const now = new Date()

		// Optimistically insert the channel
		channelCollection.insert({
			id: channelId,
			name: props.name,
			icon: (props.icon || null) as ChannelIcon | null,
			type: props.type,
			organizationId: props.organizationId,
			parentChannelId: props.parentChannelId,
			sectionId: null,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		})

		// Add creator as member
		channelMemberCollection.insert({
			id: ChannelMemberId.make(crypto.randomUUID()),
			channelId: channelId,
			userId: props.currentUserId,
			isHidden: false,
			isMuted: false,
			mutedUntil: null,
			notificationLevel: null,
			isFavorite: false,
			lastSeenMessageId: null,
			notificationCount: 0,
			joinedAt: now,
			createdAt: now,
			deletedAt: null,
		})

		return { channelId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channel.create", {
				id: ctx.mutateResult.channelId,
				name: props.name,
				icon: (props.icon || null) as ChannelIcon | null,
				type: props.type,
				organizationId: props.organizationId,
				parentChannelId: props.parentChannelId,
				sectionId: null,
				addAllMembers: props.addAllMembers,
			})
			return { data: { channelId: result.data.id }, transactionId: result.transactionId }
		}),
})

export const toggleReactionAction = optimisticAction({
	collections: [messageReactionCollection],

	onMutate: (props: { messageId: MessageId; channelId: ChannelId; emoji: string; userId: UserId }) => {
		// Check if reaction already exists in the collection
		const reactionsMap = messageReactionCollection.state
		const existingReaction = Array.from(reactionsMap.values()).find(
			(r) => r.messageId === props.messageId && r.userId === props.userId && r.emoji === props.emoji,
		)

		if (existingReaction) {
			// Toggle off: delete the existing reaction
			messageReactionCollection.delete(existingReaction.id)
			return { wasCreated: false, reactionId: existingReaction.id }
		}

		// Toggle on: insert a new reaction
		const reactionId = MessageReactionId.make(crypto.randomUUID())
		messageReactionCollection.insert({
			id: reactionId,
			messageId: props.messageId,
			channelId: props.channelId,
			conversationId: getMountedConversationId(props.channelId),
			userId: props.userId,
			emoji: props.emoji,
			createdAt: new Date(),
		})

		return { wasCreated: true, reactionId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc

			// Call the toggle RPC endpoint
			const result = yield* client("messageReaction.toggle", {
				messageId: props.messageId,
				channelId: props.channelId,
				emoji: props.emoji,
			})

			// No manual sync needed - automatic sync on messageReactionCollection!
			return { data: result, transactionId: result.transactionId }
		}),
})

export const createThreadAction = optimisticAction({
	// Only sync on channel and member collections
	// The message UPDATE (threadChannelId) will sync eventually but doesn't need to block
	collections: {
		channel: channelCollection,
		members: channelMemberCollection,
	},

	onMutate: (props: {
		threadChannelId?: ChannelId
		messageId: MessageId
		parentChannelId: ChannelId
		organizationId: OrganizationId
		currentUserId: UserId
	}) => {
		const threadChannelId = props.threadChannelId ?? ChannelId.make(crypto.randomUUID())
		const now = new Date()

		// Create thread channel
		channelCollection.insert({
			id: threadChannelId,
			name: "Thread",
			icon: null,
			type: "thread",
			organizationId: props.organizationId,
			parentChannelId: props.parentChannelId,
			sectionId: null,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		})

		// Add creator as member
		channelMemberCollection.insert({
			id: ChannelMemberId.make(crypto.randomUUID()),
			channelId: threadChannelId,
			userId: props.currentUserId,
			isHidden: false,
			isMuted: false,
			mutedUntil: null,
			notificationLevel: null,
			isFavorite: false,
			lastSeenMessageId: null,
			notificationCount: 0,
			joinedAt: now,
			createdAt: now,
			deletedAt: null,
		})

		// Link original message to thread
		messageCollection.update(props.messageId, (message) => {
			message.threadChannelId = threadChannelId
		})

		return { threadChannelId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc

			// Call dedicated thread creation endpoint that atomically:
			// 1. Creates the thread channel
			// 2. Adds creator as member
			// 3. Links the message to the thread
			const result = yield* client("channel.createThread", {
				id: ctx.mutateResult.threadChannelId,
				messageId: props.messageId,
				organizationId: props.organizationId,
				channelId: props.parentChannelId,
			})

			return {
				data: { threadChannelId: result.data.id },
				transactionId: result.transactionId,
			}
		}),
})

export const editMessageAction = optimisticAction({
	collections: [messageCollection],

	onMutate: (props: { messageId: MessageId; content: string }) => {
		const channelId = channelOfMessage(props.messageId)
		messageCollection.update(props.messageId, (message) => {
			message.content = props.content
			message.updatedAt = new Date()
		})
		return { messageId: props.messageId, channelId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("message.update", {
				id: props.messageId,
				channelId: ctx.mutateResult.channelId,
				content: props.content,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteMessageAction = optimisticAction({
	collections: [messageCollection],

	onMutate: (props: { messageId: MessageId }) => {
		const channelId = channelOfMessage(props.messageId)
		messageCollection.delete(props.messageId)
		return { messageId: props.messageId, channelId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("message.delete", {
				id: props.messageId,
				channelId: ctx.mutateResult.channelId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const pinMessageAction = optimisticAction({
	collections: [pinnedMessageCollection],

	onMutate: (props: { messageId: MessageId; channelId: ChannelId; userId: UserId }) => {
		const pinnedMessageId = PinnedMessageId.make(crypto.randomUUID())
		pinnedMessageCollection.insert({
			id: pinnedMessageId,
			channelId: props.channelId,
			messageId: props.messageId,
			pinnedBy: props.userId,
			pinnedAt: new Date(),
		})
		return { pinnedMessageId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("pinnedMessage.create", {
				channelId: props.channelId,
				messageId: props.messageId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const unpinMessageAction = optimisticAction({
	collections: [pinnedMessageCollection],

	onMutate: (props: { pinnedMessageId: PinnedMessageId }) => {
		const channelId = channelOfPin(props.pinnedMessageId)
		pinnedMessageCollection.delete(props.pinnedMessageId)
		return { pinnedMessageId: props.pinnedMessageId, channelId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("pinnedMessage.delete", {
				id: props.pinnedMessageId,
				channelId: ctx.mutateResult.channelId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateChannelAction = optimisticAction({
	collections: [channelCollection],

	onMutate: (props: { channelId: ChannelId; name: string }) => {
		channelCollection.update(props.channelId, (channel) => {
			channel.name = props.name
		})
		return { channelId: props.channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channel.update", {
				id: props.channelId,
				name: props.name,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteChannelAction = optimisticAction({
	collections: [channelCollection],

	onMutate: (props: { channelId: ChannelId }) => {
		channelCollection.delete(props.channelId)
		return { channelId: props.channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channel.delete", { id: props.channelId })
			return { data: result, transactionId: result.transactionId }
		}),
})

export const joinChannelAction = optimisticAction({
	collections: [channelMemberCollection],

	onMutate: (props: { channelId: ChannelId; userId: UserId }) => {
		const memberId = ChannelMemberId.make(crypto.randomUUID())
		const now = new Date()
		channelMemberCollection.insert({
			id: memberId,
			channelId: props.channelId,
			userId: props.userId,
			isHidden: false,
			isMuted: false,
			mutedUntil: null,
			notificationLevel: null,
			isFavorite: false,
			lastSeenMessageId: null,
			notificationCount: 0,
			joinedAt: now,
			createdAt: now,
			deletedAt: null,
		})
		return { memberId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channelMember.create", {
				channelId: props.channelId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateChannelMemberAction = optimisticAction({
	collections: [channelMemberCollection],

	onMutate: (props: {
		memberId: ChannelMemberId
		isMuted?: boolean
		isFavorite?: boolean
		isHidden?: boolean
	}) => {
		const organizationId = orgOfChannelMember(props.memberId)
		channelMemberCollection.update(props.memberId, (member) => {
			if (props.isMuted !== undefined) member.isMuted = props.isMuted
			if (props.isFavorite !== undefined) member.isFavorite = props.isFavorite
			if (props.isHidden !== undefined) member.isHidden = props.isHidden
		})
		return { memberId: props.memberId, organizationId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channelMember.update", {
				id: props.memberId,
				organizationId: ctx.mutateResult.organizationId,
				...(props.isMuted !== undefined && { isMuted: props.isMuted }),
				...(props.isFavorite !== undefined && { isFavorite: props.isFavorite }),
				...(props.isHidden !== undefined && { isHidden: props.isHidden }),
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

// Channel Section Actions

export const createChannelSectionAction = optimisticAction({
	collections: [channelSectionCollection],

	onMutate: (props: { organizationId: OrganizationId; name: string; order?: number }) => {
		const sectionId = ChannelSectionId.make(crypto.randomUUID())
		const now = new Date()

		channelSectionCollection.insert({
			id: sectionId,
			organizationId: props.organizationId,
			name: props.name,
			order: props.order ?? 0,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		})

		return { sectionId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channelSection.create", {
				id: ctx.mutateResult.sectionId,
				organizationId: props.organizationId,
				name: props.name,
				order: props.order ?? 0,
			})
			return { data: { sectionId: result.data.id }, transactionId: result.transactionId }
		}),
})

export const deleteChannelSectionAction = optimisticAction({
	collections: {
		section: channelSectionCollection,
		channel: channelCollection,
	},

	onMutate: (props: { sectionId: ChannelSectionId }) => {
		const organizationId = orgOfSection(props.sectionId)
		// Move all channels in this section back to default (sectionId = null)
		const channels = Array.from(channelCollection.state.values())
		for (const channel of channels) {
			if (channel.sectionId === props.sectionId) {
				channelCollection.update(channel.id, (c) => {
					c.sectionId = null
				})
			}
		}

		// Delete the section
		channelSectionCollection.delete(props.sectionId)
		return { sectionId: props.sectionId, organizationId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channelSection.delete", {
				id: props.sectionId,
				organizationId: ctx.mutateResult.organizationId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const moveChannelToSectionAction = optimisticAction({
	collections: [channelCollection],

	onMutate: (props: { channelId: ChannelId; sectionId: ChannelSectionId | null }) => {
		channelCollection.update(props.channelId, (channel) => {
			channel.sectionId = props.sectionId
		})
		return { channelId: props.channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("channelSection.moveChannel", {
				channelId: props.channelId,
				sectionId: props.sectionId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateOrganizationAction = optimisticAction({
	collections: [organizationCollection],

	onMutate: (props: { organizationId: OrganizationId; name?: string; logoUrl?: string | null }) => {
		organizationCollection.update(props.organizationId, (org) => {
			if (props.name !== undefined) org.name = props.name
			if (props.logoUrl !== undefined) org.logoUrl = props.logoUrl
		})
		return { organizationId: props.organizationId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("organization.update", {
				id: props.organizationId,
				...(props.name !== undefined && { name: props.name }),
				...(props.logoUrl !== undefined && { logoUrl: props.logoUrl }),
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const setPublicModeAction = optimisticAction({
	collections: [organizationCollection],

	onMutate: (props: { organizationId: OrganizationId; isPublic: boolean }) => {
		organizationCollection.update(props.organizationId, (org) => {
			org.isPublic = props.isPublic
		})
		return { organizationId: props.organizationId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("organization.setPublicMode", {
				id: props.organizationId,
				isPublic: props.isPublic,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateMemberRoleAction = optimisticAction({
	collections: [organizationMemberCollection],

	onMutate: (props: { memberId: OrganizationMemberId; role: "member" | "admin" | "owner" }) => {
		const organizationId = orgOfMember(props.memberId)
		organizationMemberCollection.update(props.memberId, (member) => {
			member.role = props.role
		})
		return { memberId: props.memberId, organizationId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("organizationMember.update", {
				id: props.memberId,
				organizationId: ctx.mutateResult.organizationId,
				role: props.role,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

// Custom Emoji Actions

export const createCustomEmojiAction = optimisticAction({
	collections: [customEmojiCollection],

	onMutate: (props: {
		organizationId: OrganizationId
		name: string
		imageUrl: string
		createdBy: UserId
	}) => {
		const emojiId = CustomEmojiId.make(crypto.randomUUID())
		const now = new Date()

		customEmojiCollection.insert({
			id: emojiId,
			organizationId: props.organizationId,
			name: props.name,
			imageUrl: props.imageUrl,
			createdBy: props.createdBy,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		})

		return { emojiId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customEmoji.create", {
				organizationId: props.organizationId,
				name: props.name,
				imageUrl: props.imageUrl,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const restoreCustomEmojiAction = optimisticAction({
	collections: [customEmojiCollection],

	onMutate: (props: {
		emojiId: CustomEmojiId
		organizationId: OrganizationId
		name: string
		imageUrl: string
		createdBy: UserId
	}) => {
		// Deleted emojis aren't in the local collection, so insert optimistically
		customEmojiCollection.insert({
			id: props.emojiId,
			organizationId: props.organizationId,
			name: props.name,
			imageUrl: props.imageUrl,
			createdBy: props.createdBy,
			createdAt: new Date(),
			updatedAt: new Date(),
			deletedAt: null,
		})

		return { emojiId: props.emojiId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customEmoji.restore", {
				id: props.emojiId,
				organizationId: props.organizationId,
				imageUrl: props.imageUrl,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteCustomEmojiAction = optimisticAction({
	collections: [customEmojiCollection],

	onMutate: (props: { emojiId: CustomEmojiId }) => {
		const organizationId = orgOfEmoji(props.emojiId)
		customEmojiCollection.update(props.emojiId, (emoji) => {
			emoji.deletedAt = new Date()
		})
		return { emojiId: props.emojiId, organizationId }
	},

	mutate: (props, ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customEmoji.delete", {
				id: props.emojiId,
				organizationId: ctx.mutateResult.organizationId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})
