import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { MessageId, OrganizationId } from "@hazel/schema"
import { format } from "date-fns"
import { createContext, memo, useCallback, useMemo, useRef, type ReactNode, type RefObject } from "react"
import type { MessageWithPinned } from "~/atoms/chat-query-atoms"
import { customEmojiMapAtomFamily } from "~/atoms/custom-emoji-atoms"
import { emojiUsageAtom } from "~/atoms/emoji-atoms"
import { isDiscordSyncedMessageAtomFamily, processedReactionsAtomFamily } from "~/atoms/message-atoms"
import IconDiscord from "~/components/icons/icon-discord"
import IconPin from "~/components/icons/icon-pin"
import { extractUrls } from "~/components/link-preview"
import { StatusEmojiWithTooltip } from "~/components/status/user-status-badge"
import { Badge } from "~/components/ui/badge"
import { useChatStable } from "~/hooks/use-chat"
import { useUserStatus } from "~/hooks/use-presence"
import { useAuth } from "~/lib/auth"
import { cn, toDate, toEpochMs } from "~/lib/utils"
import { useChatAuthorIdentity, type ChatAuthorIdentity } from "./author-identity"
import { InlineThreadPreview } from "./inline-thread-preview"
import { MessageAttachments } from "./message-attachments"
import { MessageContent } from "./message-content"
import { MessageContextMenu as ContextMenuComponent } from "./message-context-menu"
import { MessageReplySection } from "./message-reply-section"
import { ReactionButton } from "./reaction-button"
import { UserProfilePopover } from "./user-profile-popover"

/**
 * Position of the message within a group of consecutive messages from the same author
 * - 'start': First message in a group (shows avatar)
 * - 'middle': Message between start and end
 * - 'end': Last message in a group
 * - 'standalone': Single message (both start and end)
 */
export type MessageGroupPosition = "start" | "middle" | "end" | "standalone"

/**
 * Visual highlight style for the message
 * - 'new': First new/unread message highlight
 * - 'pinned': Pinned message with special styling
 * - 'search': Highlighted from search result (animated)
 * - 'none': No highlight
 */
export type MessageHighlight = "new" | "pinned" | "search" | "none"

/**
 * Variant-based props for Message components
 */
export interface MessageVariants {
	/** Position within a message group - controls avatar visibility and spacing */
	groupPosition?: MessageGroupPosition
	/** Highlight style for the message - controls visual emphasis */
	highlight?: MessageHighlight
}

// Context for sharing message state across compound components
interface MessageContextValue {
	message: MessageWithPinned
	messageRef: RefObject<HTMLDivElement | null>
	// Derived states
	groupPosition: MessageGroupPosition
	highlight: MessageHighlight
	isGroupStart: boolean
	isGroupEnd: boolean
	isPinned: boolean
	isFirstNewMessage: boolean
	isHighlighted: boolean
	showAvatar: boolean
	isRepliedTo: boolean
	// Actions
	handleReaction: (emoji: string) => void
	handleReplyClick: () => void
	// User info
	currentUserId: string | undefined
	organizationId: OrganizationId | undefined
	authorIdentity: ChatAuthorIdentity
	// Aggregated reactions
	aggregatedReactions: [string, { count: number; users: string[]; hasReacted: boolean }][]
}

const MessageContext = createContext<MessageContextValue | null>(null)

function useMessage() {
	const context = React.use(MessageContext)
	if (!context) {
		throw new Error("Message compound components must be used within Message.Provider")
	}
	return context
}

import React from "react"

interface MessageProviderProps {
	message: MessageWithPinned
	variants?: MessageVariants
	children: ReactNode
}

/**
 * Provider component that sets up the message context with all shared state and actions.
 * All other Message.* components must be rendered within this provider.
 */
function MessageProvider({ message, variants, children }: MessageProviderProps) {
	const { addReaction } = useChatStable()
	const setEmojiUsage = useAtomSet(emojiUsageAtom)
	const { user: currentUser } = useAuth()
	const messageRef = useRef<HTMLDivElement>(null)

	// Resolve variants
	const groupPosition = variants?.groupPosition ?? "standalone"
	const highlight = variants?.highlight ?? "none"

	// Derived state from variants
	const isGroupStart = groupPosition === "start" || groupPosition === "standalone"
	const isGroupEnd = groupPosition === "end" || groupPosition === "standalone"
	const isFirstNewMessage = highlight === "new"
	const isPinned = highlight === "pinned"
	const isHighlighted = highlight === "search"

	const isRepliedTo = !!message?.replyToMessageId
	const authorIdentity = useChatAuthorIdentity(message.authorId, message.author)

	// Check if message has embeds (rich/webhook embeds or URL-based embeds)
	const hasEmbed = useMemo(() => {
		if (message.embeds && message.embeds.length > 0) return true
		const urls = extractUrls(message.content)
		return urls.length > 0
	}, [message.embeds, message.content])

	const showAvatar = isGroupStart || isRepliedTo || hasEmbed

	// Stabilize atom key to prevent atom family recreation on every render
	const reactionsAtomKey = useMemo(
		() => `${message.id}:${currentUser?.id || ""}` as `${MessageId}:${string}`,
		[message.id, currentUser?.id],
	)
	// Use atom for reactions - automatically deduplicated and memoized
	const aggregatedReactions = useAtomValue(processedReactionsAtomFamily(reactionsAtomKey))

	// Memoize reaction handler to prevent ReactionButton re-renders
	const handleReaction = useCallback(
		(emoji: string) => {
			if (!message) return
			setEmojiUsage((prev) => ({ ...prev, [emoji]: (prev[emoji] || 0) + 1 }))
			addReaction(message.id, message.channelId, emoji)
		},
		[message, setEmojiUsage, addReaction],
	)

	// Memoize reply click handler
	const handleReplyClick = useCallback(() => {
		if (!message.replyToMessageId) return
		const replyElement = document.getElementById(`message-${message.replyToMessageId}`)
		if (!replyElement) return
		replyElement.scrollIntoView({ behavior: "smooth", block: "center" })
		// Add a highlight effect
		replyElement.classList.add("bg-secondary/30")
		setTimeout(() => {
			replyElement.classList.remove("bg-secondary/30")
		}, 2000)
	}, [message.replyToMessageId])

	const contextValue: MessageContextValue = {
		message,
		messageRef,
		groupPosition,
		highlight,
		isGroupStart,
		isGroupEnd,
		isPinned,
		isFirstNewMessage,
		isHighlighted,
		showAvatar,
		isRepliedTo,
		handleReaction,
		handleReplyClick,
		currentUserId: currentUser?.id,
		// Coerce null to undefined for organizationId
		organizationId: currentUser?.organizationId ?? undefined,
		authorIdentity,
		aggregatedReactions,
	}

	return <MessageContext value={contextValue}>{children}</MessageContext>
}

interface MessageFrameProps {
	children: ReactNode
}

/**
 * Container component that handles the message frame styling, hover state, and layout.
 */
function MessageFrame({ children }: MessageFrameProps) {
	const { message, messageRef, isGroupStart, isGroupEnd, isPinned, isFirstNewMessage, isHighlighted } =
		useMessage()

	return (
		<div
			ref={messageRef}
			id={`message-${message.id}`}
			className={cn(
				"group relative flex flex-col rounded-lg px-0.5 py-1 hover:bg-secondary",
				isGroupStart ? "mt-2" : "",
				isGroupEnd ? "mb-2" : "",
				isFirstNewMessage
					? "rounded-l-none border-success border-l-2 bg-success/10 hover:bg-success/5"
					: "",
				isPinned
					? "rounded-l-none border-warning border-l-4 bg-warning/10 pl-2 shadow-sm hover:bg-warning/15"
					: "",
				isHighlighted && "bg-accent/20 transition-colors duration-300",
			)}
			data-id={message.id}
		>
			{children}
		</div>
	)
}

interface MessageContextMenuWrapperProps {
	children: ReactNode
}

/**
 * Wrapper component that provides the context menu functionality.
 */
function MessageContextMenuWrapper({ children }: MessageContextMenuWrapperProps) {
	const { message } = useMessage()
	return <ContextMenuComponent message={message}>{children}</ContextMenuComponent>
}

/**
 * Renders the avatar or hover timestamp based on group position.
 */
function MessageAvatar() {
	const { message, showAvatar, authorIdentity } = useMessage()

	if (showAvatar) {
		return (
			<UserProfilePopover
				userId={message.authorId}
				userName={authorIdentity.displayName || undefined}
				userAvatarUrl={authorIdentity.avatarUrl}
			/>
		)
	}

	return (
		<div className="flex w-10 items-center justify-end pr-1 text-[10px] text-muted-fg leading-tight opacity-0 group-hover:opacity-100">
			{format(toDate(message.createdAt), "HH:mm")}
		</div>
	)
}

/**
 * Renders the message author header with name, status, timestamp, and badges.
 */
const MessageHeader = memo(function MessageHeader() {
	const { message, showAvatar, isPinned, authorIdentity } = useMessage()
	const user = message.author
	const { statusEmoji, customMessage, statusExpiresAt, quietHours } = useUserStatus(message.authorId)
	const isDiscordSyncedResult = useAtomValue(isDiscordSyncedMessageAtomFamily(message.id))
	const isDiscordSynced = AsyncResult.getOrElse(isDiscordSyncedResult, () => []).length > 0

	const isEdited = message.updatedAt && toEpochMs(message.updatedAt) > toEpochMs(message.createdAt)

	if (!showAvatar || !user) return null

	const fullName = authorIdentity.displayName

	return (
		<div className="flex items-baseline gap-2">
			<span className="font-semibold text-fg">{fullName}</span>
			<StatusEmojiWithTooltip
				emoji={statusEmoji}
				message={customMessage}
				expiresAt={statusExpiresAt}
				quietHours={quietHours}
			/>
			{user.userType === "machine" && isDiscordSynced ? (
				<span className="inline-flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-xs/5 font-medium text-primary-fg">
					<IconDiscord className="size-3" fill="currentColor" />
					Discord
				</span>
			) : user.userType === "machine" ? (
				<Badge intent="primary">APP</Badge>
			) : isDiscordSynced ? (
				<Badge intent="secondary">Synced from Discord</Badge>
			) : null}
			<span className="text-muted-fg text-xs">
				{format(toDate(message.createdAt), "HH:mm")}
				{isEdited && " (edited)"}
			</span>
			{isPinned && (
				<span className="flex items-center gap-1 text-warning text-xs" title="Pinned message">
					<IconPin className="size-3" />
					<span>Pinned</span>
				</span>
			)}
		</div>
	)
})

/**
 * Renders the reply section when the message is a reply to another message.
 */
function MessageReplySectionComponent() {
	const { message, isRepliedTo, handleReplyClick } = useMessage()

	if (!isRepliedTo || !message.replyToMessageId) return null

	return <MessageReplySection replyToMessageId={message.replyToMessageId} onClick={handleReplyClick} />
}

/**
 * Renders the message text and embeds using the MessageContent compound component.
 */
function MessageContentComponent() {
	const { message, organizationId } = useMessage()

	return (
		<MessageContent.Provider message={message} organizationId={organizationId}>
			<MessageContent.Text />
			<MessageContent.Embeds />
		</MessageContent.Provider>
	)
}

/**
 * Renders file attachments for the message.
 */
function MessageAttachmentsComponent() {
	const { message } = useMessage()
	return <MessageAttachments messageId={message.id} />
}

/**
 * Renders the reaction buttons for the message.
 */
const MessageReactions = memo(function MessageReactions() {
	const { aggregatedReactions, handleReaction, currentUserId, organizationId } = useMessage()

	if (aggregatedReactions.length === 0) return null

	return (
		<div className="mt-2 flex flex-wrap gap-1">
			{aggregatedReactions.map(([emoji, data]) => (
				<ReactionButton
					key={emoji}
					emoji={emoji}
					data={data}
					onReaction={handleReaction}
					currentUserId={currentUserId}
					customEmojiImageUrl={
						emoji.startsWith("custom:") && organizationId
							? undefined // resolved in wrapper below
							: undefined
					}
				/>
			))}
			{/* Re-render with custom emoji resolution when org is available */}
		</div>
	)
})

/**
 * Wrapper that resolves custom emoji image URLs from the org's custom emoji map.
 * Uses a separate component to avoid subscribing all messages to the emoji atom.
 */
const MessageReactionsWithCustomEmojis = memo(function MessageReactionsWithCustomEmojis() {
	const { aggregatedReactions, handleReaction, currentUserId, organizationId } = useMessage()
	const hasCustomEmojis = aggregatedReactions.some(([emoji]) => emoji.startsWith("custom:"))

	if (aggregatedReactions.length === 0) return null

	if (!hasCustomEmojis || !organizationId) {
		return (
			<div className="mt-2 flex flex-wrap gap-1">
				{aggregatedReactions.map(([emoji, data]) => (
					<ReactionButton
						key={emoji}
						emoji={emoji}
						data={data}
						onReaction={handleReaction}
						currentUserId={currentUserId}
					/>
				))}
			</div>
		)
	}

	return <ReactionListWithEmojiMap organizationId={organizationId} />
})

/** Inner component that subscribes to the custom emoji map atom */
function ReactionListWithEmojiMap({ organizationId }: { organizationId: OrganizationId }) {
	const { aggregatedReactions, handleReaction, currentUserId } = useMessage()
	const emojiMap = useAtomValue(customEmojiMapAtomFamily(organizationId))

	return (
		<div className="mt-2 flex flex-wrap gap-1">
			{aggregatedReactions.map(([emoji, data]) => {
				const customInfo = emoji.startsWith("custom:") ? emojiMap.get(emoji) : undefined
				return (
					<ReactionButton
						key={emoji}
						emoji={emoji}
						data={data}
						onReaction={handleReaction}
						currentUserId={currentUserId}
						customEmojiImageUrl={customInfo?.imageUrl}
					/>
				)
			})}
		</div>
	)
}

/**
 * Renders the inline thread preview if the message has a thread.
 */
function MessageThreadPreview() {
	const { message } = useMessage()

	if (!message.threadChannelId) return null

	return <InlineThreadPreview threadChannelId={message.threadChannelId} messageId={message.id} />
}

/**
 * Compound component for rendering messages with composition.
 *
 * This allows different message variants (main chat, thread, search result, etc.)
 * to compose only the pieces they need without boolean props.
 *
 * @example Main chat message with all features:
 * ```tsx
 * <Message.Provider message={message} variants={variants}>
 *   <Message.ContextMenu>
 *     <Message.Frame>
 *       <Message.ReplySection />
 *       <div className="flex gap-4">
 *         <Message.Avatar />
 *         <div className="min-w-0 flex-1">
 *           <Message.Header />
 *           <Message.Content />
 *           <Message.Attachments />
 *           <Message.Reactions />
 *           <Message.ThreadPreview />
 *         </div>
 *       </div>
 *     </Message.Frame>
 *   </Message.ContextMenu>
 * </Message.Provider>
 * ```
 *
 * @example Thread message (no thread preview):
 * ```tsx
 * <Message.Provider message={message} variants={variants}>
 *   <Message.ContextMenu>
 *     <Message.Frame>
 *       <Message.ReplySection />
 *       <div className="flex gap-4">
 *         <Message.Avatar />
 *         <div className="min-w-0 flex-1">
 *           <Message.Header />
 *           <Message.Content />
 *           <Message.Attachments />
 *           <Message.Reactions />
 *         </div>
 *       </div>
 *     </Message.Frame>
 *   </Message.ContextMenu>
 * </Message.Provider>
 * ```
 */
export const Message = {
	Provider: MessageProvider,
	Frame: MessageFrame,
	ContextMenu: MessageContextMenuWrapper,
	Avatar: MessageAvatar,
	Header: MessageHeader,
	ReplySection: MessageReplySectionComponent,
	Content: MessageContentComponent,
	Attachments: MessageAttachmentsComponent,
	Reactions: MessageReactionsWithCustomEmojis,
	ThreadPreview: MessageThreadPreview,
}

// Also export the useMessage hook for advanced use cases
export { useMessage }
