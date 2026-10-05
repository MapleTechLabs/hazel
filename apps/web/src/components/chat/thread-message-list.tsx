import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { ChannelId } from "@hazel/schema"
import { useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import type { MessageWithPinned } from "~/atoms/chat-query-atoms"
import { useMessageToolbarOverlay } from "~/hooks/use-message-toolbar-overlay"
import { toEpochMs } from "~/lib/utils"
import { threadMessagesWithAuthorAtomFamily } from "~/atoms/message-atoms"
import { MessageHoverProvider, useMessageHover } from "~/providers/message-hover-provider"
import type { MessageGroupPosition } from "./message"
import { MessageToolbar } from "./message-toolbar"
import { ThreadMessageItem } from "./thread-message-item"

interface ThreadMessageListProps {
	threadChannelId: ChannelId
}

/**
 * ThreadMessageList displays messages within a thread with full feature parity
 * to the main chat window, including:
 * - Right-click context menu
 * - Hover toolbar with quick actions
 * - Reactions display and quick reactions
 * - Message grouping
 * - User profile popovers
 *
 * Uses the composition pattern via ThreadMessageItem (which uses Message.* compound components)
 * to share the same building blocks as the main MessageItem.
 */
export function ThreadMessageList({ threadChannelId }: ThreadMessageListProps) {
	return (
		<MessageHoverProvider>
			<ThreadMessageListContent threadChannelId={threadChannelId} />
		</MessageHoverProvider>
	)
}

interface ProcessedThreadMessage {
	message: MessageWithPinned
	groupPosition: MessageGroupPosition
}

function ThreadMessageListContent({ threadChannelId }: ThreadMessageListProps) {
	const { state, actions, meta } = useMessageHover()

	// Query thread messages with author data using the new atom
	const messagesResult = useAtomValue(threadMessagesWithAuthorAtomFamily({ threadChannelId }))
	const messages = AsyncResult.getOrElse(messagesResult, () => []) as MessageWithPinned[]

	// Find the hovered message for the toolbar
	const hoveredMessage = useMemo(
		() => messages.find((m) => m.id === state.hoveredMessageId) || null,
		[messages, state.hoveredMessageId],
	)
	const isToolbarRequested = state.hoveredMessageId !== null || meta.isToolbarMenuOpen
	const { overlayRef, overlayProps, hasAnchorTarget } = useMessageToolbarOverlay({
		targetElement: state.targetElement,
		isOpen: isToolbarRequested,
	})

	// Process messages with grouping logic
	const processedMessages = useMemo((): ProcessedThreadMessage[] => {
		const timeThreshold = 3 * 60 * 1000 // 3 minutes

		return messages.map((message, index): ProcessedThreadMessage => {
			const prevMessage = index > 0 ? messages[index - 1] : null
			const isGroupStart =
				!prevMessage ||
				message.authorId !== prevMessage.authorId ||
				toEpochMs(message.createdAt) - toEpochMs(prevMessage.createdAt) > timeThreshold ||
				!!prevMessage.replyToMessageId

			const nextMessage = index < messages.length - 1 ? messages[index + 1] : null
			const isGroupEnd =
				!nextMessage ||
				message.authorId !== nextMessage.authorId ||
				toEpochMs(nextMessage.createdAt) - toEpochMs(message.createdAt) > timeThreshold

			// Determine group position
			let groupPosition: MessageGroupPosition
			if (isGroupStart && isGroupEnd) {
				groupPosition = "standalone"
			} else if (isGroupStart) {
				groupPosition = "start"
			} else if (isGroupEnd) {
				groupPosition = "end"
			} else {
				groupPosition = "middle"
			}

			return {
				message,
				groupPosition,
			}
		})
	}, [messages])

	const handlePointerOver = useCallback(
		(e: React.PointerEvent) => {
			const messageEl = (e.target as HTMLElement).closest("[data-id]") as HTMLDivElement | null
			if (messageEl) {
				actions.setHovered(messageEl.dataset.id!, messageEl)
			}
		},
		[actions],
	)

	const handlePointerLeave = useCallback(() => {
		actions.setHovered(null, null)
	}, [actions])

	if (messages.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<p className="text-muted-fg">No replies yet. Start the conversation!</p>
			</div>
		)
	}

	return (
		<div
			className="flex h-full flex-col overflow-y-auto px-2 py-2"
			onPointerOver={handlePointerOver}
			onPointerLeave={handlePointerLeave}
		>
			{/* Apply highlight style to hovered message */}
			{state.hoveredMessageId && (
				<style>{`#message-${state.hoveredMessageId} { background-color: var(--color-secondary) !important; }`}</style>
			)}

			{processedMessages.map(({ message, groupPosition }) => (
				<ThreadMessageItem key={message.id} message={message} groupPosition={groupPosition} />
			))}

			{/* Toolbar portal - renders floating toolbar when hovering a message */}
			{isToolbarRequested &&
				hoveredMessage &&
				hasAnchorTarget &&
				createPortal(
					<div
						ref={overlayRef}
						{...overlayProps}
						style={{ ...overlayProps.style, zIndex: 50 }}
						role="group"
						onMouseEnter={() => {
							actions.setToolbarHovered(true)
						}}
						onMouseLeave={() => {
							actions.setToolbarHovered(false)
						}}
					>
						{/* Invisible padding for larger hitbox */}
						<div className="-m-3 p-3">
							<MessageToolbar message={hoveredMessage} />
						</div>
					</div>,
					document.body,
				)}
		</div>
	)
}
