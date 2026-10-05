import { type User } from "@hazel/domain/models"
import type {
	AttachmentId,
	ChannelIcon,
	ChannelId,
	ChannelMemberId,
	ChannelSectionId,
	CustomEmojiId,
	MessageId,
	MessageReactionId,
	OrganizationId,
	PinnedMessageId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Schedule, Duration } from "effect"
import { isRetryableError } from "~/lib/error-messages"

/**
 * Wraps an error in a Cause and checks if it's retryable.
 * Used by Schedule.whileInput which provides raw errors.
 */
const isErrorRetryable = (error: unknown): boolean => {
	const cause = Cause.fail(error)
	return isRetryableError(cause)
}
import { HazelRpcClient } from "~/lib/services/common/rpc-atom-client"
import { runtime } from "~/lib/services/common/runtime"
import { getSharedConversationIdForChannel } from "~/lib/connect-shared-channels"
import { optimisticAction } from "../../../../libs/effect-electric-db-collection/src"
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
	pinnedMessageCollection,
	userCollection,
} from "./collections"

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
	Schedule.while((metadata) => isErrorRetryable(metadata.input)),
	(schedule) => Schedule.max([schedule, Schedule.recurs(3)]),
)

export const sendMessageAction = optimisticAction({
	// Only sync on messageCollection - attachments are updated in the same backend transaction,
	// but the attachments Electric stream won't contain the txid unless attachment rows were actually
	// modified (i.e., when attachments are provided). Syncing on messageCollection alone is sufficient
	// to confirm the transaction committed.
	collections: [messageCollection],
	runtime: runtime,

	onMutate: (props: {
		messageId?: MessageId // Accept pre-generated ID for retry tracking
		channelId: ChannelId
		authorId: UserId
		content: string
		replyToMessageId?: MessageId | null
		threadChannelId?: ChannelId | null
		attachmentIds?: AttachmentId[]
		onRetryAttempt?: (attempt: number) => void
	}) => {
		const messageId = props.messageId ?? (crypto.randomUUID() as MessageId)

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
			const client = yield* HazelRpcClient

			// Create retry schedule with optional attempt callback
			const scheduleWithCallback = props.onRetryAttempt
				? MessageRetrySchedule.pipe(
						Schedule.tap(({ attempt }) => Effect.sync(() => props.onRetryAttempt!(attempt))),
					)
				: MessageRetrySchedule

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
			}).pipe(Effect.retry(scheduleWithCallback))

			// No manual sync needed - automatic sync on messageCollection!
			console.debug(
				`[txid-debug] sendMessage RPC result.transactionId:`,
				result.transactionId,
				`type:`,
				typeof result.transactionId,
				`full result keys:`,
				Object.keys(result),
			)
			return { data: result, transactionId: result.transactionId }
		}),
})

export const createChannelAction = optimisticAction({
	// Skip sync wait - TanStack awaitTxId hangs during Electric shape conflicts (409 errors)
	// Optimistic inserts + RPC still work correctly
	collections: [],
	runtime: runtime,
	onMutate: (props: {
		organizationId: OrganizationId
		name: string
		icon?: string | null
		type: "public" | "private" | "thread"
		parentChannelId: ChannelId | null
		currentUserId: UserId
		addAllMembers?: boolean
	}) => {
		const channelId = crypto.randomUUID() as ChannelId
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
			id: crypto.randomUUID() as ChannelMemberId,
			channelId: channelId,
			userId: props.currentUserId,
			isHidden: false,
			isMuted: false,
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
			const client = yield* HazelRpcClient
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

export const createDmChannelAction = optimisticAction({
	collections: {
		channel: channelCollection,
		members: channelMemberCollection,
	},
	runtime: runtime,

	onMutate: (props: {
		organizationId: OrganizationId
		participantIds: UserId[]
		type: "single" | "direct"
		name?: string
		currentUserId: UserId
	}) => {
		const channelId = crypto.randomUUID() as ChannelId
		const now = new Date()

		let channelName = props.name
		if (props.type === "single" && props.participantIds.length === 1) {
			channelName = channelName || "Direct Message"
		}

		// Optimistically insert the channel
		channelCollection.insert({
			id: channelId,
			name: channelName || "Group Channel",
			icon: null,
			type: props.type === "direct" ? "single" : "direct",
			organizationId: props.organizationId,
			parentChannelId: null,
			sectionId: null,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		})

		// Add current user as member
		channelMemberCollection.insert({
			id: crypto.randomUUID() as ChannelMemberId,
			channelId: channelId,
			userId: props.currentUserId,
			isHidden: false,
			isMuted: false,
			isFavorite: false,
			lastSeenMessageId: null,
			notificationCount: 0,
			joinedAt: now,
			createdAt: now,
			deletedAt: null,
		})

		// Add all participants as members
		for (const participantId of props.participantIds) {
			channelMemberCollection.insert({
				id: crypto.randomUUID() as ChannelMemberId,
				channelId: channelId,
				userId: participantId,
				isHidden: false,
				isMuted: false,
				isFavorite: false,
				lastSeenMessageId: null,
				notificationCount: 0,
				joinedAt: now,
				createdAt: now,
				deletedAt: null,
			})
		}

		return { channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient

			const result = yield* client("channel.createDm", {
				organizationId: props.organizationId,
				participantIds: props.participantIds,
				type: props.type,
				name: props.name,
			})

			// No manual sync needed - automatic sync on BOTH channel AND members collections!
			return {
				data: { channelId: result.data.id },
				transactionId: result.transactionId,
			}
		}),
})

export const createOrganizationAction = optimisticAction({
	collections: [organizationCollection],
	runtime: runtime,

	onMutate: (props: { name: string; slug: string; logoUrl?: string | null }) => {
		const organizationId = crypto.randomUUID() as OrganizationId
		const now = new Date()

		organizationCollection.insert({
			id: organizationId,
			name: props.name,
			slug: props.slug,
			logoUrl: props.logoUrl || null,
			settings: {},
			isPublic: false,
			createdAt: now,
			updatedAt: null,
			deletedAt: null,
		})

		return { organizationId, slug: props.slug }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("organization.create", {
				name: props.name,
				slug: props.slug,
				logoUrl: props.logoUrl ?? null,
				settings: null,
				isPublic: false,
			})

			// No manual sync needed - automatic sync on organizationCollection!
			return {
				data: {
					organizationId: result.data.id,
					slug: result.data.slug,
				},
				transactionId: result.transactionId,
			}
		}),
})

export const toggleReactionAction = optimisticAction({
	collections: [messageReactionCollection],
	runtime: runtime,

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
		const reactionId = crypto.randomUUID() as MessageReactionId
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
			const client = yield* HazelRpcClient

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
	runtime: runtime,

	onMutate: (props: {
		threadChannelId?: ChannelId
		messageId: MessageId
		parentChannelId: ChannelId
		organizationId: OrganizationId
		currentUserId: UserId
	}) => {
		const threadChannelId = props.threadChannelId ?? (crypto.randomUUID() as ChannelId)
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
			id: crypto.randomUUID() as ChannelMemberId,
			channelId: threadChannelId,
			userId: props.currentUserId,
			isHidden: false,
			isMuted: false,
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
			const client = yield* HazelRpcClient

			// Call dedicated thread creation endpoint that atomically:
			// 1. Creates the thread channel
			// 2. Adds creator as member
			// 3. Links the message to the thread
			const result = yield* client("channel.createThread", {
				id: ctx.mutateResult.threadChannelId,
				messageId: props.messageId,
				organizationId: props.organizationId,
			})

			return {
				data: { threadChannelId: result.data.id },
				transactionId: result.transactionId,
			}
		}),
})

/**
 * Updates Hazel-specific user preferences (timezone, settings).
 * Identity fields (firstName/lastName/avatarUrl) live in Clerk — update them
 * via `useUser().user.update(...)` / `setProfileImage(...)` and let the Clerk
 * webhook sync them back.
 */
export const updateUserAction = optimisticAction({
	collections: [userCollection],
	runtime: runtime,

	onMutate: (props: { userId: UserId; timezone?: string | null; settings?: User.UserSettings | null }) => {
		userCollection.update(props.userId, (draft) => {
			if (props.timezone !== undefined) draft.timezone = props.timezone
			if (props.settings !== undefined) draft.settings = props.settings
		})

		return { userId: props.userId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient

			const result = yield* client("user.update", {
				id: props.userId,
				...(props.timezone !== undefined && { timezone: props.timezone }),
				...(props.settings !== undefined && { settings: props.settings }),
			})

			return result
		}),
})

export const editMessageAction = optimisticAction({
	collections: [messageCollection],
	runtime: runtime,

	onMutate: (props: { messageId: MessageId; content: string }) => {
		messageCollection.update(props.messageId, (message) => {
			message.content = props.content
			message.updatedAt = new Date()
		})
		return { messageId: props.messageId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("message.update", {
				id: props.messageId,
				content: props.content,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteMessageAction = optimisticAction({
	collections: [messageCollection],
	runtime: runtime,

	onMutate: (props: { messageId: MessageId }) => {
		messageCollection.delete(props.messageId)
		return { messageId: props.messageId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("message.delete", { id: props.messageId })
			return { data: result, transactionId: result.transactionId }
		}),
})

export const pinMessageAction = optimisticAction({
	collections: [pinnedMessageCollection],
	runtime: runtime,

	onMutate: (props: { messageId: MessageId; channelId: ChannelId; userId: UserId }) => {
		const pinnedMessageId = crypto.randomUUID() as PinnedMessageId
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
			const client = yield* HazelRpcClient
			const result = yield* client("pinnedMessage.create", {
				channelId: props.channelId,
				messageId: props.messageId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const unpinMessageAction = optimisticAction({
	collections: [pinnedMessageCollection],
	runtime: runtime,

	onMutate: (props: { pinnedMessageId: PinnedMessageId }) => {
		pinnedMessageCollection.delete(props.pinnedMessageId)
		return { pinnedMessageId: props.pinnedMessageId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("pinnedMessage.delete", { id: props.pinnedMessageId })
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateChannelAction = optimisticAction({
	collections: [channelCollection],
	runtime: runtime,

	onMutate: (props: { channelId: ChannelId; name: string }) => {
		channelCollection.update(props.channelId, (channel) => {
			channel.name = props.name
		})
		return { channelId: props.channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channel.update", {
				id: props.channelId,
				name: props.name,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteChannelAction = optimisticAction({
	collections: [channelCollection],
	runtime: runtime,

	onMutate: (props: { channelId: ChannelId }) => {
		channelCollection.delete(props.channelId)
		return { channelId: props.channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channel.delete", { id: props.channelId })
			return { data: result, transactionId: result.transactionId }
		}),
})

export const joinChannelAction = optimisticAction({
	collections: [],
	runtime: runtime,

	onMutate: (props: { channelId: ChannelId; userId: UserId }) => {
		const memberId = crypto.randomUUID() as ChannelMemberId
		const now = new Date()
		channelMemberCollection.insert({
			id: memberId,
			channelId: props.channelId,
			userId: props.userId,
			isHidden: false,
			isMuted: false,
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
			const client = yield* HazelRpcClient
			const result = yield* client("channelMember.create", {
				channelId: props.channelId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateChannelMemberAction = optimisticAction({
	collections: [channelMemberCollection],
	runtime: runtime,

	onMutate: (props: {
		memberId: ChannelMemberId
		isMuted?: boolean
		isFavorite?: boolean
		isHidden?: boolean
	}) => {
		channelMemberCollection.update(props.memberId, (member) => {
			if (props.isMuted !== undefined) member.isMuted = props.isMuted
			if (props.isFavorite !== undefined) member.isFavorite = props.isFavorite
			if (props.isHidden !== undefined) member.isHidden = props.isHidden
		})
		return { memberId: props.memberId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channelMember.update", {
				id: props.memberId,
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
	runtime: runtime,

	onMutate: (props: { organizationId: OrganizationId; name: string; order?: number }) => {
		const sectionId = crypto.randomUUID() as ChannelSectionId
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
			const client = yield* HazelRpcClient
			const result = yield* client("channelSection.create", {
				id: ctx.mutateResult.sectionId,
				organizationId: props.organizationId,
				name: props.name,
				order: props.order ?? 0,
			})
			return { data: { sectionId: result.data.id }, transactionId: result.transactionId }
		}),
})

export const updateChannelSectionAction = optimisticAction({
	collections: [channelSectionCollection],
	runtime: runtime,

	onMutate: (props: { sectionId: ChannelSectionId; name?: string; order?: number }) => {
		channelSectionCollection.update(props.sectionId, (section) => {
			if (props.name !== undefined) section.name = props.name
			if (props.order !== undefined) section.order = props.order
		})
		return { sectionId: props.sectionId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channelSection.update", {
				id: props.sectionId,
				...(props.name !== undefined && { name: props.name }),
				...(props.order !== undefined && { order: props.order }),
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteChannelSectionAction = optimisticAction({
	collections: {
		section: channelSectionCollection,
		channel: channelCollection,
	},
	runtime: runtime,

	onMutate: (props: { sectionId: ChannelSectionId }) => {
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
		return { sectionId: props.sectionId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channelSection.delete", { id: props.sectionId })
			return { data: result, transactionId: result.transactionId }
		}),
})

export const moveChannelToSectionAction = optimisticAction({
	collections: [channelCollection],
	runtime: runtime,

	onMutate: (props: { channelId: ChannelId; sectionId: ChannelSectionId | null }) => {
		channelCollection.update(props.channelId, (channel) => {
			channel.sectionId = props.sectionId
		})
		return { channelId: props.channelId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channelSection.moveChannel", {
				channelId: props.channelId,
				sectionId: props.sectionId,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const reorderSectionsAction = optimisticAction({
	collections: [channelSectionCollection],
	runtime: runtime,

	onMutate: (props: { organizationId: OrganizationId; sectionIds: ChannelSectionId[] }) => {
		// Update order for each section
		for (let i = 0; i < props.sectionIds.length; i++) {
			const sectionId = props.sectionIds[i]!
			channelSectionCollection.update(sectionId, (section) => {
				section.order = i
			})
		}
		return { sectionIds: props.sectionIds }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("channelSection.reorder", {
				organizationId: props.organizationId,
				sectionIds: props.sectionIds,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const updateOrganizationAction = optimisticAction({
	collections: [organizationCollection],
	runtime: runtime,

	onMutate: (props: { organizationId: OrganizationId; name?: string; logoUrl?: string | null }) => {
		organizationCollection.update(props.organizationId, (org) => {
			if (props.name !== undefined) org.name = props.name
			if (props.logoUrl !== undefined) org.logoUrl = props.logoUrl
		})
		return { organizationId: props.organizationId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
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
	runtime: runtime,

	onMutate: (props: { organizationId: OrganizationId; isPublic: boolean }) => {
		organizationCollection.update(props.organizationId, (org) => {
			org.isPublic = props.isPublic
		})
		return { organizationId: props.organizationId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("organization.setPublicMode", {
				id: props.organizationId,
				isPublic: props.isPublic,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

// Custom Emoji Actions

export const createCustomEmojiAction = optimisticAction({
	collections: [customEmojiCollection],
	runtime: runtime,

	onMutate: (props: {
		organizationId: OrganizationId
		name: string
		imageUrl: string
		createdBy: UserId
	}) => {
		const emojiId = crypto.randomUUID() as CustomEmojiId
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
			const client = yield* HazelRpcClient
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
	runtime: runtime,

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
			const client = yield* HazelRpcClient
			const result = yield* client("customEmoji.restore", {
				id: props.emojiId,
				imageUrl: props.imageUrl,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const deleteCustomEmojiAction = optimisticAction({
	collections: [customEmojiCollection],
	runtime: runtime,

	onMutate: (props: { emojiId: CustomEmojiId }) => {
		customEmojiCollection.update(props.emojiId, (emoji) => {
			emoji.deletedAt = new Date()
		})
		return { emojiId: props.emojiId }
	},

	mutate: (props, _ctx) =>
		Effect.gen(function* () {
			const client = yield* HazelRpcClient
			const result = yield* client("customEmoji.delete", { id: props.emojiId })
			return { data: result, transactionId: result.transactionId }
		}),
})
