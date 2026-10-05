import { LegendList, type LegendListRef, type ViewToken } from "@legendapp/list"
import { useAtomValue } from "@effect/atom-react"
import type { ChannelId } from "@hazel/schema"
import { useLiveInfiniteQuery } from "@tanstack/react-db"
import { memo, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { editingMessageAtomFamily } from "~/atoms/chat-atoms"
import type { MessageWithPinned, ProcessedMessage } from "~/atoms/chat-query-atoms"
import { useVisibleMessageNotificationCleaner } from "~/hooks/use-visible-message-notification-cleaner"
import { useMessageToolbarOverlay } from "~/hooks/use-message-toolbar-overlay"
import { toEpochMs, toDate } from "~/lib/utils"
import { MessageHoverProvider, useMessageHover } from "~/providers/message-hover-provider"

import { Route } from "~/routes/_app/$orgSlug/chat/$id"
import { MessageItem, type MessageGroupPosition, type MessageHighlight } from "./message-item"
import { MessageToolbar } from "./message-toolbar"

/** Viewability config for LegendList - hoisted to prevent re-creation on every render */
const VIEWABILITY_CONFIG = {
	itemVisiblePercentThreshold: 50,
	minimumViewTime: 300,
} as const

/** Helper to convert boolean flags to group position */
function toGroupPosition(isGroupStart: boolean, isGroupEnd: boolean): MessageGroupPosition {
	if (isGroupStart && isGroupEnd) return "standalone"
	if (isGroupStart) return "start"
	if (isGroupEnd) return "end"
	return "middle"
}

/** Helper to convert boolean flags to highlight type */
function toHighlight(isFirstNewMessage: boolean, isPinned: boolean): MessageHighlight {
	if (isPinned) return "pinned"
	if (isFirstNewMessage) return "new"
	return "none"
}

/** Date divider that shows a horizontal line only when not stuck to the top */
function DateDivider({ date, isStuck }: { date: string; isStuck: boolean }) {
	return (
		<div className="sticky top-0 z-0 my-2 flex items-center justify-center">
			{!isStuck && <div className="absolute inset-x-4 border-t border-border" />}
			<span className="relative rounded-lg bg-secondary px-3 py-1 font-mono text-muted-fg text-xs shadow-sm">
				{date}
			</span>
		</div>
	)
}

type MessageRowHeader = { id: string; type: "header"; date: string }
type MessageRowItem = { id: string; type: "row" } & ProcessedMessage
type MessageRow = MessageRowHeader | MessageRowItem

interface MessageVirtualListProps {
	messageRows: MessageRow[]
	stickyIndices: number[]
	hasNextPage: boolean
	fetchNextPage: () => void
	onViewableItemsChanged?: (info: { viewableItems: ViewToken<MessageRow>[] }) => void
}

const MessageVirtualList = memo(
	({
		messageRows,
		stickyIndices,
		hasNextPage,
		fetchNextPage,
		onViewableItemsChanged,
		ref,
	}: MessageVirtualListProps & { ref: React.Ref<LegendListRef> }) => {
		const [activeStickyIndex, setActiveStickyIndex] = useState<number | undefined>()

		return (
			<LegendList<MessageRow>
				ref={ref}
				alignItemsAtEnd
				maintainScrollAtEnd
				maintainScrollAtEndThreshold={0.5}
				maintainVisibleContentPosition
				suggestEstimatedItemSize
				data={messageRows}
				onStartReached={() => {
					if (hasNextPage) {
						fetchNextPage()
					}
				}}
				recycleItems
				drawDistance={300}
				estimatedItemSize={80}
				keyExtractor={(it) => it.id}
				initialScrollIndex={messageRows.length - 1}
				stickyHeaderIndices={stickyIndices}
				onStickyHeaderChange={({ index }) => setActiveStickyIndex(index)}
				viewabilityConfig={VIEWABILITY_CONFIG}
				onViewableItemsChanged={onViewableItemsChanged}
				renderItem={(props) =>
					props.item.type === "header" ? (
						<DateDivider date={props.item.date} isStuck={props.index === activeStickyIndex} />
					) : (
						<MessageItem
							message={props.item.message}
							groupPosition={toGroupPosition(props.item.isGroupStart, props.item.isGroupEnd)}
							highlight={toHighlight(props.item.isFirstNewMessage, props.item.isPinned)}
						/>
					)
				}
				style={{ flex: 1, minHeight: 0 }}
			/>
		)
	},
)

MessageVirtualList.displayName = "MessageVirtualList"

export interface MessageListRef {
	scrollToBottom: () => void
	// TODO: Implement scroll-to-message - see GitHub issue
}

interface MessageListContentProps {
	messages: MessageWithPinned[]
	isLoading: boolean
	hasNextPage: boolean
	fetchNextPage: () => void
	channelId: ChannelId
	legendListRef: React.RefObject<LegendListRef | null>
}

function MessageListContent({
	messages,
	isLoading,
	hasNextPage,
	fetchNextPage,
	channelId,
	legendListRef,
}: MessageListContentProps) {
	const { state, actions, meta } = useMessageHover()

	// Subscribe to editing state directly via atom (avoids ChatProvider dependency)
	const editingMessageId = useAtomValue(editingMessageAtomFamily(channelId))

	// Hook for clearing notifications when messages become visible
	const { onVisibleMessagesChange } = useVisibleMessageNotificationCleaner({
		channelId,
	})

	// Handle viewable items changes from LegendList
	const handleViewableItemsChanged = useCallback(
		({ viewableItems }: { viewableItems: ViewToken<MessageRow>[] }) => {
			// Extract message IDs from viewable items (exclude headers)
			const visibleMessageIds = viewableItems
				.filter((item) => item.item?.type === "row")
				.map((item) => item.item.id)

			onVisibleMessagesChange(visibleMessageIds)
		},
		[onVisibleMessagesChange],
	)

	// O(1) lookup for hovered message instead of O(n) scan
	const messageMap = useMemo(() => {
		const map = new Map<string, MessageWithPinned>()
		for (const m of messages) {
			map.set(m.id, m)
		}
		return map
	}, [messages])

	const hoveredMessage = state.hoveredMessageId ? (messageMap.get(state.hoveredMessageId) ?? null) : null
	const isToolbarRequested = state.hoveredMessageId !== null || meta.isToolbarMenuOpen
	const { overlayRef, overlayProps, hasAnchorTarget } = useMessageToolbarOverlay({
		targetElement: state.targetElement,
		isOpen: isToolbarRequested,
	})

	// Process messages without reversing the array.
	// `messages` is ordered DESC (newest first), so we iterate backwards for chronological order.
	const processedMessages = useMemo(() => {
		const timeThreshold = 3 * 60 * 1000
		const len = messages.length
		const result: ProcessedMessage[] = new Array(len)

		for (let i = 0; i < len; i++) {
			// Map chronological index i -> DESC array index
			const descIdx = len - 1 - i
			const message = messages[descIdx]!

			// Previous message in chronological order = descIdx + 1
			const prevMessage = descIdx < len - 1 ? messages[descIdx + 1]! : null
			// Next message in chronological order = descIdx - 1
			const nextMessage = descIdx > 0 ? messages[descIdx - 1]! : null

			const isGroupStart =
				!prevMessage ||
				message.authorId !== prevMessage.authorId ||
				toEpochMs(message.createdAt) - toEpochMs(prevMessage.createdAt) > timeThreshold ||
				!!prevMessage.replyToMessageId

			const isGroupEnd =
				!nextMessage ||
				message.authorId !== nextMessage.authorId ||
				toEpochMs(nextMessage.createdAt) - toEpochMs(message.createdAt) > timeThreshold

			const isFirstNewMessage = false
			const isPinned = !!message.pinnedMessage?.id

			result[i] = {
				message,
				isGroupStart,
				isGroupEnd,
				isFirstNewMessage,
				isPinned,
			}
		}
		return result
	}, [messages])

	const { messageRows, stickyIndices } = useMemo(() => {
		const rows: MessageRow[] = []
		const sticky: number[] = []
		let idx = 0
		let lastDate = ""

		for (const processedMessage of processedMessages) {
			const date = toDate(processedMessage.message.createdAt).toDateString()
			if (date !== lastDate) {
				rows.push({ id: `header-${date}`, type: "header", date })
				sticky.push(idx)
				idx++
				lastDate = date
			}
			rows.push({
				id: processedMessage.message.id,
				type: "row",
				...processedMessage,
			})
			idx++
		}
		return { messageRows: rows, stickyIndices: sticky }
	}, [processedMessages])

	const containerStyle = useMemo(
		() => ({
			overflowAnchor: "auto" as const,
			scrollBehavior: "auto" as const,
			opacity: isLoading && messages.length > 0 ? 0.7 : 1,
		}),
		[isLoading, messages.length],
	)

	// Delegated hover handler - single listener instead of per-message useHover
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

	// Show empty state if no messages (no skeleton loader needed since route loader preloads data)
	if (messages.length === 0) {
		return (
			<div className="flex size-full flex-col items-center justify-center p-4 sm:p-8">
				<div className="relative aspect-square w-full max-w-sm">
					<img
						src="/images/squirrle_ocean.webp"
						alt="squirrel"
						className="mask-size-[110%_90%] mask-linear-to-r mask-from-black mask-to-transparent mask-center mask-no-repeat mask-[url(/images/image-mask.webp)] h-full w-full rounded-md bg-center bg-cover bg-no-repeat object-cover opacity-50"
					/>
				</div>
				<p className="font-bold font-mono text-fg text-xl">Quiet as an ocean gazing squirrel...</p>
			</div>
		)
	}

	return (
		<div
			className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2 transition-opacity duration-200"
			style={containerStyle}
			onPointerOver={handlePointerOver}
			onPointerLeave={handlePointerLeave}
		>
			{/* CSS injection for hover highlighting - avoids per-message context subscriptions */}
			{state.hoveredMessageId && (
				<style>{`#message-${state.hoveredMessageId} { background-color: var(--color-secondary) !important; }`}</style>
			)}
			{/* CSS injection for editing highlight - avoids per-message context subscriptions */}
			{editingMessageId && (
				<style>{`#message-${editingMessageId} { border-left: 4px solid var(--color-primary); background-color: color-mix(in srgb, var(--color-primary) 10%, transparent); padding-left: 0.5rem; border-top-left-radius: 0; border-bottom-left-radius: 0; box-shadow: var(--shadow-sm); }`}</style>
			)}
			<MessageVirtualList
				ref={legendListRef}
				messageRows={messageRows}
				stickyIndices={stickyIndices}
				hasNextPage={hasNextPage}
				fetchNextPage={fetchNextPage}
				onViewableItemsChanged={handleViewableItemsChanged}
			/>

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

export function MessageList({ ref }: { ref?: React.Ref<MessageListRef> }) {
	const { messagesInfiniteQuery } = Route.useLoaderData()
	const { id } = Route.useParams()
	const channelId = id as ChannelId

	const legendListRef = useRef<LegendListRef>(null)

	useImperativeHandle(ref, () => ({
		scrollToBottom: () => {
			legendListRef.current?.scrollToEnd({ animated: true })
		},
	}))

	const { data, fetchNextPage, hasNextPage, isLoading } = useLiveInfiniteQuery(messagesInfiniteQuery, {
		pageSize: 30,
	})

	const messages = (data || []) as MessageWithPinned[]

	return (
		<MessageHoverProvider>
			<MessageListContent
				messages={messages}
				isLoading={isLoading}
				hasNextPage={hasNextPage}
				fetchNextPage={fetchNextPage}
				channelId={channelId}
				legendListRef={legendListRef}
			/>
		</MessageHoverProvider>
	)
}
