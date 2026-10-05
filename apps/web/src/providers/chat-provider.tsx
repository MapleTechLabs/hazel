import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Channel } from "@hazel/domain/models"
import type {
	AttachmentId,
	ChannelId,
	MessageId,
	MessageReactionId,
	OrganizationId,
	PinnedMessageId,
	UserId,
} from "@hazel/schema"
import { Exit } from "effect"
import { toast } from "sonner"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react"
import {
	activeThreadChannelIdAtom,
	activeThreadMessageIdAtom,
	editingMessageAtomFamily,
	isUploadingAtomFamily,
	replyToMessageAtomFamily,
	type UploadingFile,
	uploadedAttachmentsAtomFamily,
	uploadingFilesAtomFamily,
} from "~/atoms/chat-atoms"
import { channelByIdAtomFamily } from "~/atoms/chat-query-atoms"
import {
	createThreadAction,
	deleteMessageAction,
	editMessageAction,
	pinMessageAction,
	sendMessageAction,
	toggleReactionAction,
	unpinMessageAction,
} from "~/db/actions"
import { useAuth } from "~/lib/auth"
import { exitToast } from "~/lib/toast-exit"

interface SendMessageProps {
	content: string
	attachments?: AttachmentId[]
	clearContent?: () => void
	restoreContent?: (content: string) => void
}

// ─── Stable Context ─────────────────────────────────────────────────────────
// Values and actions that only change when the channel changes.
// Message components should subscribe to this context.

export interface ChatStableValue {
	channelId: ChannelId
	organizationId: OrganizationId
	channel: Channel.Type | undefined
	// All actions (sendMessage is stabilized via refs)
	sendMessage: (props: SendMessageProps) => void
	editMessage: (messageId: MessageId, content: string) => Promise<void>
	deleteMessage: (messageId: MessageId) => void
	addReaction: (messageId: MessageId, channelId: ChannelId, emoji: string) => void
	/** @deprecated Use addReaction which toggles reactions */
	removeReaction: (reactionId: MessageReactionId) => void
	pinMessage: (messageId: MessageId) => void
	unpinMessage: (pinnedMessageId: PinnedMessageId) => void
	createThread: (messageId: MessageId, threadChannelId: ChannelId | null) => Promise<void>
	openThread: (threadChannelId: ChannelId, originalMessageId: MessageId) => void
	closeThread: () => void
	setReplyToMessageId: (messageId: MessageId | null) => void
	setEditingMessageId: (messageId: MessageId | null) => void
	addAttachment: (attachmentId: AttachmentId) => void
	removeAttachment: (attachmentId: AttachmentId) => void
	clearAttachments: () => void
	setIsUploading: (value: boolean) => void
	addUploadingFile: (file: Omit<UploadingFile, "progress">) => void
	updateUploadingFileProgress: (fileId: string, progress: number) => void
	removeUploadingFile: (fileId: string) => void
}

// ─── Draft Context ──────────────────────────────────────────────────────────
// Values that change during message composition (reply, edit, attachments).
// Composer components should subscribe to this context.

export interface ChatDraftValue {
	replyToMessageId: MessageId | null
	editingMessageId: MessageId | null
	attachmentIds: AttachmentId[]
	isUploading: boolean
	uploadingFiles: UploadingFile[]
}

// ─── Thread Context ─────────────────────────────────────────────────────────
// Values that change when thread state changes.

export interface ChatThreadValue {
	activeThreadChannelId: ChannelId | null
	activeThreadMessageId: MessageId | null
	isThreadCreating: boolean
}

// ─── Legacy types (backwards compatibility) ─────────────────────────────────

export interface ChatState {
	channelId: ChannelId
	organizationId: OrganizationId
	channel: Channel.Type | undefined
	replyToMessageId: MessageId | null
	attachmentIds: AttachmentId[]
	isUploading: boolean
	uploadingFiles: UploadingFile[]
	activeThreadChannelId: ChannelId | null
	activeThreadMessageId: MessageId | null
	isThreadCreating: boolean
	editingMessageId: MessageId | null
}

export interface ChatActions {
	sendMessage: (props: SendMessageProps) => void
	editMessage: (messageId: MessageId, content: string) => Promise<void>
	deleteMessage: (messageId: MessageId) => void
	addReaction: (messageId: MessageId, channelId: ChannelId, emoji: string) => void
	/** @deprecated Use addReaction which toggles reactions */
	removeReaction: (reactionId: MessageReactionId) => void
	pinMessage: (messageId: MessageId) => void
	unpinMessage: (pinnedMessageId: PinnedMessageId) => void
	createThread: (messageId: MessageId, threadChannelId: ChannelId | null) => Promise<void>
	openThread: (threadChannelId: ChannelId, originalMessageId: MessageId) => void
	closeThread: () => void
	setReplyToMessageId: (messageId: MessageId | null) => void
	setEditingMessageId: (messageId: MessageId | null) => void
	addAttachment: (attachmentId: AttachmentId) => void
	removeAttachment: (attachmentId: AttachmentId) => void
	clearAttachments: () => void
	setIsUploading: (value: boolean) => void
	addUploadingFile: (file: Omit<UploadingFile, "progress">) => void
	updateUploadingFileProgress: (fileId: string, progress: number) => void
	removeUploadingFile: (fileId: string) => void
}

export interface ChatMeta {}

export type ChatContextValue = ChatState & ChatActions & ChatMeta

// ─── Contexts ───────────────────────────────────────────────────────────────

const ChatStableContext = createContext<ChatStableValue | undefined>(undefined)
const ChatDraftContext = createContext<ChatDraftValue | undefined>(undefined)
const ChatThreadContext = createContext<ChatThreadValue | undefined>(undefined)

// ─── Targeted hooks ─────────────────────────────────────────────────────────

/**
 * Hook for stable channel values and all actions.
 * Only re-renders when the channel changes. Use this in message components.
 */
export function useChatStable(): ChatStableValue {
	const context = useContext(ChatStableContext)
	if (!context) {
		throw new Error("useChatStable must be used within a ChatProvider")
	}
	return context
}

/**
 * Hook for draft/composition state (reply, edit, attachments, uploads).
 * Re-renders when composition state changes. Use this in composer components.
 */
export function useChatDraft(): ChatDraftValue {
	const context = useContext(ChatDraftContext)
	if (!context) {
		throw new Error("useChatDraft must be used within a ChatProvider")
	}
	return context
}

/**
 * Hook for thread state (active thread, creating state).
 * Re-renders when thread state changes. Use this in thread panel components.
 */
export function useChatThread(): ChatThreadValue {
	const context = useContext(ChatThreadContext)
	if (!context) {
		throw new Error("useChatThread must be used within a ChatProvider")
	}
	return context
}

// ─── Legacy hooks (backwards compatibility) ─────────────────────────────────

/**
 * @deprecated Use `useChatStable()`, `useChatDraft()`, or `useChatThread()` instead.
 * Returns flattened context with all state and actions.
 */
export function useChat(): ChatContextValue {
	const stable = useChatStable()
	const draft = useChatDraft()
	const thread = useChatThread()
	return useMemo(
		() => ({
			...stable,
			...draft,
			...thread,
		}),
		[stable, draft, thread],
	)
}

/** @deprecated Use targeted hooks instead */
export interface ChatContextStructured {
	state: ChatState
	actions: ChatActions
	meta: ChatMeta
}

/** @deprecated Use targeted hooks instead */
export function useChatContext(): ChatContextStructured {
	const stable = useChatStable()
	const draft = useChatDraft()
	const thread = useChatThread()
	return useMemo(
		() => ({
			state: {
				channelId: stable.channelId,
				organizationId: stable.organizationId,
				channel: stable.channel,
				...draft,
				...thread,
			},
			actions: stable,
			meta: {},
		}),
		[stable, draft, thread],
	)
}

/** @deprecated Use `useChatDraft()` or `useChatStable()` instead */
export function useChatState(): ChatState {
	const { state } = useChatContext()
	return state
}

/** @deprecated Use `useChatStable()` instead */
export function useChatActions(): ChatActions {
	const { actions } = useChatContext()
	return actions
}

// ─── Provider ───────────────────────────────────────────────────────────────

interface ChatProviderProps {
	channelId: ChannelId
	organizationId: OrganizationId
	children: ReactNode
	onMessageSent?: () => void
}

export function ChatProvider({ channelId, organizationId, children, onMessageSent }: ChatProviderProps) {
	"use no memo"
	const { user } = useAuth()

	const sendMessageMutation = useAtomSet(sendMessageAction, { mode: "promiseExit" })
	const toggleReactionMutation = useAtomSet(toggleReactionAction, { mode: "promiseExit" })
	const createThreadMutation = useAtomSet(createThreadAction, { mode: "promiseExit" })
	const editMessageMutation = useAtomSet(editMessageAction, { mode: "promiseExit" })
	const deleteMessageMutation = useAtomSet(deleteMessageAction, { mode: "promiseExit" })
	const pinMessageMutation = useAtomSet(pinMessageAction, { mode: "promiseExit" })
	const unpinMessageMutation = useAtomSet(unpinMessageAction, { mode: "promiseExit" })

	const replyToMessageId = useAtomValue(replyToMessageAtomFamily(channelId))
	const setReplyToMessageIdRaw = useAtomSet(replyToMessageAtomFamily(channelId))

	const editingMessageId = useAtomValue(editingMessageAtomFamily(channelId))
	const setEditingMessageIdRaw = useAtomSet(editingMessageAtomFamily(channelId))

	const activeThreadChannelId = useAtomValue(activeThreadChannelIdAtom)
	const setActiveThreadChannelId = useAtomSet(activeThreadChannelIdAtom)
	const activeThreadMessageId = useAtomValue(activeThreadMessageIdAtom)
	const setActiveThreadMessageId = useAtomSet(activeThreadMessageIdAtom)

	const attachmentIds = useAtomValue(uploadedAttachmentsAtomFamily(channelId))
	const setAttachmentIds = useAtomSet(uploadedAttachmentsAtomFamily(channelId))

	const isUploading = useAtomValue(isUploadingAtomFamily(channelId))
	const setIsUploading = useAtomSet(isUploadingAtomFamily(channelId))

	const uploadingFiles = useAtomValue(uploadingFilesAtomFamily(channelId))
	const setUploadingFiles = useAtomSet(uploadingFilesAtomFamily(channelId))

	const channelResult = useAtomValue(channelByIdAtomFamily(channelId))
	const channel = AsyncResult.getOrElse(channelResult, () => undefined)

	// Track pending thread creation to disable composer until thread is created
	const [pendingThreadChannelId, setPendingThreadChannelId] = useState<ChannelId | null>(null)
	const isThreadCreating =
		pendingThreadChannelId === activeThreadChannelId && pendingThreadChannelId !== null

	const addAttachment = useCallback(
		(attachmentId: AttachmentId) => {
			setAttachmentIds((prev) => [...prev, attachmentId])
		},
		[setAttachmentIds],
	)

	const removeAttachment = useCallback(
		(attachmentId: AttachmentId) => {
			setAttachmentIds((prev) => prev.filter((id) => id !== attachmentId))
		},
		[setAttachmentIds],
	)

	const clearAttachments = useCallback(() => {
		setAttachmentIds([])
	}, [setAttachmentIds])

	const addUploadingFile = useCallback(
		(file: Omit<UploadingFile, "progress">) => {
			setUploadingFiles((prev) => [...prev, { ...file, progress: 0 }])
		},
		[setUploadingFiles],
	)

	const updateUploadingFileProgress = useCallback(
		(fileId: string, progress: number) => {
			setUploadingFiles((prev) => prev.map((f) => (f.fileId === fileId ? { ...f, progress } : f)))
		},
		[setUploadingFiles],
	)

	const removeUploadingFile = useCallback(
		(fileId: string) => {
			setUploadingFiles((prev) => prev.filter((f) => f.fileId !== fileId))
		},
		[setUploadingFiles],
	)

	// Mutual exclusion: entering reply clears edit, and vice versa
	const setReplyToMessageId = useCallback(
		(messageId: MessageId | null) => {
			if (messageId) {
				setEditingMessageIdRaw(null)
			}
			setReplyToMessageIdRaw(messageId)
		},
		[setReplyToMessageIdRaw, setEditingMessageIdRaw],
	)

	const setEditingMessageId = useCallback(
		(messageId: MessageId | null) => {
			if (messageId) {
				setReplyToMessageIdRaw(null)
			}
			setEditingMessageIdRaw(messageId)
		},
		[setEditingMessageIdRaw, setReplyToMessageIdRaw],
	)

	// ─── Stabilize sendMessage with refs ────────────────────────────────────
	// Use refs to capture volatile state (replyToMessageId, attachmentIds)
	// at call time instead of as closure dependencies. This makes sendMessage
	// stable and prevents cascading re-renders across all consumers.

	const replyToMessageIdRef = useRef(replyToMessageId)
	replyToMessageIdRef.current = replyToMessageId

	const attachmentIdsRef = useRef(attachmentIds)
	attachmentIdsRef.current = attachmentIds

	// Store pending message data for manual retry
	const pendingMessageRef = useRef<{
		content: string
		replyToMessageId: MessageId | null
		attachmentIds: AttachmentId[]
		clearContent?: () => void
		restoreContent?: (content: string) => void
	} | null>(null)

	const sendMessage = useCallback(
		async ({ content, attachments, clearContent, restoreContent }: SendMessageProps) => {
			if (!user?.id) return
			const attachmentsToSend = attachments ?? attachmentIdsRef.current

			// Save state for potential restore on error
			const savedReplyToMessageId = replyToMessageIdRef.current
			const savedAttachmentIds = [...attachmentsToSend]

			// Store pending message data for manual retry
			pendingMessageRef.current = {
				content,
				replyToMessageId: savedReplyToMessageId,
				attachmentIds: savedAttachmentIds,
				clearContent,
				restoreContent,
			}

			// Optimistically clear everything
			clearContent?.()
			setReplyToMessageId(null)
			clearAttachments()

			const tx = await sendMessageMutation({
				channelId,
				authorId: user.id as UserId,
				content,
				replyToMessageId: savedReplyToMessageId,
				threadChannelId: null,
				attachmentIds: savedAttachmentIds as AttachmentId[] | undefined,
			})

			if (Exit.isSuccess(tx)) {
				pendingMessageRef.current = null
				onMessageSent?.()
			} else {
				// Restore state on error (after automatic retries exhausted)
				restoreContent?.(content)
				setReplyToMessageId(savedReplyToMessageId)
				setAttachmentIds(savedAttachmentIds)

				exitToast(tx)
					.onErrorTag("RateLimitExceededError", (e) => ({
						title: "Rate limit exceeded",
						description: `Please wait ${Math.ceil(e.retryAfterMs / 1000)} seconds before sending another message.`,
						isRetryable: false,
					}))
					.onErrorTag("ChannelNotFoundError", () => ({
						title: "Channel not found",
						description: "This channel may have been deleted.",
						isRetryable: false,
					}))
					.onCommonErrorTag("SyncError", () => ({
						title: "Message sent",
						description: "Sync is delayed but your message was delivered.",
						isRetryable: false,
					}))
					.withRetry({
						label: "Retry",
						onRetry: () => {
							// Manual retry after all automatic retries exhausted
							if (pendingMessageRef.current) {
								const pending = pendingMessageRef.current
								sendMessage({
									content: pending.content,
									attachments: pending.attachmentIds,
									clearContent: pending.clearContent,
									restoreContent: pending.restoreContent,
								})
							}
						},
					})
					.run()
			}
		},
		[
			channelId,
			user?.id,
			sendMessageMutation,
			setReplyToMessageId,
			setAttachmentIds,
			clearAttachments,
			onMessageSent,
		],
	)

	const editMessage = useCallback(
		async (messageId: MessageId, content: string) => {
			const exit = await editMessageMutation({ messageId, content })
			exitToast(exit)
				.onErrorTag("RateLimitExceededError", (e) => ({
					title: "Rate limit exceeded",
					description: `Please wait ${Math.ceil(e.retryAfterMs / 1000)} seconds before trying again.`,
					isRetryable: false,
				}))
				.onErrorTag("MessageNotFoundError", () => ({
					title: "Message not found",
					description: "This message may have been deleted.",
					isRetryable: false,
				}))
				.run()
		},
		[editMessageMutation],
	)

	const deleteMessage = useCallback(
		async (messageId: MessageId) => {
			const exit = await deleteMessageMutation({ messageId })
			exitToast(exit)
				.onErrorTag("RateLimitExceededError", (e) => ({
					title: "Rate limit exceeded",
					description: `Please wait ${Math.ceil(e.retryAfterMs / 1000)} seconds before trying again.`,
					isRetryable: false,
				}))
				.onErrorTag("MessageNotFoundError", () => ({
					title: "Message not found",
					description: "This message may have already been deleted.",
					isRetryable: false,
				}))
				.run()
		},
		[deleteMessageMutation],
	)

	const addReaction = useCallback(
		async (messageId: MessageId, channelId: ChannelId, emoji: string) => {
			if (!user?.id) return

			const tx = await toggleReactionMutation({
				messageId,
				channelId,
				emoji,
				userId: user.id as UserId,
			})

			exitToast(tx)
				.onErrorTag("MessageNotFoundError", () => ({
					title: "Message not found",
					description: "This message may have been deleted.",
					isRetryable: false,
				}))
				.run()
		},
		[user?.id, toggleReactionMutation],
	)

	// Note: removeReaction is deprecated - use addReaction which toggles reactions
	const removeReaction = useCallback((_reactionId: MessageReactionId) => {
		console.warn("removeReaction is deprecated - use addReaction to toggle reactions")
	}, [])

	const pinMessage = useCallback(
		async (messageId: MessageId) => {
			if (!user?.id) return

			const exit = await pinMessageMutation({
				messageId,
				channelId,
				userId: user.id as UserId,
			})

			exitToast(exit)
				.successMessage("Message pinned")
				.onErrorTag("MessageNotFoundError", () => ({
					title: "Message not found",
					description: "This message may have been deleted.",
					isRetryable: false,
				}))
				.run()
		},
		[channelId, user?.id, pinMessageMutation],
	)

	const unpinMessage = useCallback(
		async (pinnedMessageId: PinnedMessageId) => {
			const exit = await unpinMessageMutation({ pinnedMessageId })

			exitToast(exit)
				.successMessage("Message unpinned")
				.onErrorTag("PinnedMessageNotFoundError", () => ({
					title: "Pin not found",
					description: "This message may have already been unpinned.",
					isRetryable: false,
				}))
				.run()
		},
		[unpinMessageMutation],
	)

	const createThread = useCallback(
		async (messageId: MessageId, existingThreadChannelId: ChannelId | null) => {
			// Prevent nested threads
			if (channel?.type === "thread") {
				toast.error("Cannot create threads within threads")
				return
			}

			if (existingThreadChannelId) {
				// Thread already exists - just open it
				setActiveThreadChannelId(existingThreadChannelId)
				setActiveThreadMessageId(messageId)
			} else {
				if (!user?.id) return

				// Generate thread channel ID upfront for optimistic UI
				const threadChannelId = crypto.randomUUID() as ChannelId

				// Open panel IMMEDIATELY with optimistic ID
				setActiveThreadChannelId(threadChannelId)
				setActiveThreadMessageId(messageId)

				// Track that this thread is being created (disables composer)
				setPendingThreadChannelId(threadChannelId)

				// Create thread in background
				const exit = await createThreadMutation({
					threadChannelId,
					messageId,
					parentChannelId: channelId,
					organizationId,
					currentUserId: user.id as UserId,
				})

				// Clear pending state
				setPendingThreadChannelId(null)

				exitToast(exit)
					.onErrorTag("MessageNotFoundError", () => ({
						title: "Message not found",
						description: "The message no longer exists",
						isRetryable: false,
					}))
					.onErrorTag("NestedThreadError", () => ({
						title: "Cannot create thread",
						description: "Threads cannot be created within threads",
						isRetryable: false,
					}))
					.run()

				// Close panel on failure
				if (!Exit.isSuccess(exit)) {
					setActiveThreadChannelId(null)
					setActiveThreadMessageId(null)
				}
			}
		},
		[
			channel?.type,
			channelId,
			organizationId,
			user?.id,
			createThreadMutation,
			setActiveThreadChannelId,
			setActiveThreadMessageId,
		],
	)

	const openThread = useCallback(
		(threadChannelId: ChannelId, originalMessageId: MessageId) => {
			setActiveThreadChannelId(threadChannelId)
			setActiveThreadMessageId(originalMessageId)
		},
		[setActiveThreadChannelId, setActiveThreadMessageId],
	)

	const closeThread = useCallback(() => {
		setActiveThreadChannelId(null)
		setActiveThreadMessageId(null)
	}, [setActiveThreadChannelId, setActiveThreadMessageId])

	// ─── Build context values ───────────────────────────────────────────────

	const stableValue = useMemo<ChatStableValue>(
		() => ({
			channelId,
			organizationId,
			channel,
			sendMessage,
			editMessage,
			deleteMessage,
			addReaction,
			removeReaction,
			pinMessage,
			unpinMessage,
			createThread,
			openThread,
			closeThread,
			setReplyToMessageId,
			setEditingMessageId,
			addAttachment,
			removeAttachment,
			clearAttachments,
			setIsUploading,
			addUploadingFile,
			updateUploadingFileProgress,
			removeUploadingFile,
		}),
		[
			channelId,
			organizationId,
			channel,
			sendMessage,
			editMessage,
			deleteMessage,
			addReaction,
			removeReaction,
			pinMessage,
			unpinMessage,
			createThread,
			openThread,
			closeThread,
			setReplyToMessageId,
			setEditingMessageId,
			addAttachment,
			removeAttachment,
			clearAttachments,
			setIsUploading,
			addUploadingFile,
			updateUploadingFileProgress,
			removeUploadingFile,
		],
	)

	const draftValue = useMemo<ChatDraftValue>(
		() => ({
			replyToMessageId,
			editingMessageId,
			attachmentIds,
			isUploading,
			uploadingFiles,
		}),
		[replyToMessageId, editingMessageId, attachmentIds, isUploading, uploadingFiles],
	)

	const threadValue = useMemo<ChatThreadValue>(
		() => ({
			activeThreadChannelId,
			activeThreadMessageId,
			isThreadCreating,
		}),
		[activeThreadChannelId, activeThreadMessageId, isThreadCreating],
	)

	return (
		<ChatStableContext.Provider value={stableValue}>
			<ChatDraftContext.Provider value={draftValue}>
				<ChatThreadContext.Provider value={threadValue}>{children}</ChatThreadContext.Provider>
			</ChatDraftContext.Provider>
		</ChatStableContext.Provider>
	)
}
