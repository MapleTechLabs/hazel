import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { formatDistanceToNow } from "date-fns"
import { useMemo } from "react"
import { toDate } from "~/lib/utils"
import { threadMessageCountAtomFamily, userWithPresenceAtomFamily } from "~/atoms/message-atoms"
import { channelCollection, messageCollection } from "~/db/collections"
import { useChatStable } from "~/hooks/use-chat"
import { cx } from "~/utils/cx"
import { Avatar } from "../ui/avatar"
import { useChatAuthorIdentity } from "./author-identity"

interface InlineThreadPreviewProps {
	threadChannelId: ChannelId
	messageId: MessageId
	maxPreviewMessages?: number
}

export function InlineThreadPreview({
	threadChannelId,
	messageId,
	maxPreviewMessages = 3,
}: InlineThreadPreviewProps) {
	const { openThread } = useChatStable()

	// Fetch thread name
	const { data: threadData } = useLiveQuery(
		(q) => q.from({ channel: channelCollection }).where((q) => eq(q.channel.id, threadChannelId)),
		[threadChannelId],
	)
	const threadName = threadData?.[0]?.name
	const hasCustomName = threadName && threadName !== "Thread"

	// Get total thread message count using atom
	const countResult = useAtomValue(threadMessageCountAtomFamily(threadChannelId))
	const countData = AsyncResult.getOrElse(countResult, () => [])
	const totalCount = countData?.[0]?.count ?? 0

	// Get last message timestamp and unique authors for avatar stack
	const { data: threadMessages } = useLiveQuery(
		(q) =>
			q
				.from({ message: messageCollection })
				.where(({ message }) => eq(message.channelId, threadChannelId))
				.orderBy(({ message }) => message.createdAt, "desc")
				.limit(10), // Get enough to find unique authors
		[threadChannelId],
	)

	// Get unique author IDs (up to maxPreviewMessages)
	const uniqueAuthorIds = useMemo(() => {
		if (!threadMessages) return []
		const seen = new Set<UserId>()
		const ids: UserId[] = []
		for (const msg of threadMessages) {
			if (!seen.has(msg.authorId) && ids.length < maxPreviewMessages) {
				seen.add(msg.authorId)
				ids.push(msg.authorId)
			}
		}
		return ids
	}, [threadMessages, maxPreviewMessages])

	// Get last reply timestamp
	const lastReplyAt = threadMessages?.[0]?.createdAt

	if (totalCount === 0) {
		return null
	}

	return (
		<button
			type="button"
			onClick={() => openThread(threadChannelId, messageId)}
			className={cx(
				"group/thread mt-1 flex items-center gap-2 rounded-md py-1 px-1 -ml-1 max-w-full",
				"transition-colors hover:bg-secondary/60 active:bg-secondary/80",
				"cursor-pointer select-none",
			)}
		>
			{/* Avatar stack */}
			<div className="shrink-0">
				<AvatarStack authorIds={uniqueAuthorIds} />
			</div>

			{/* Thread info */}
			<div className="flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap">
				{/* Thread name if custom */}
				{hasCustomName && (
					<>
						<span className="max-w-[150px] truncate font-medium text-fg/80">{threadName}</span>
						<span className="shrink-0 text-muted-fg">·</span>
					</>
				)}

				{/* Reply count - primary action color */}
				<span className="shrink-0 font-medium text-primary group-hover/thread:underline">
					{totalCount} {totalCount === 1 ? "reply" : "replies"}
				</span>

				{/* Reply time / View thread - swap on hover without layout shift */}
				<span className="shrink-0 text-muted-fg">·</span>
				<span className="relative shrink-0">
					{/* Last reply time - invisible on hover but keeps space */}
					{lastReplyAt && (
						<span className="text-muted-fg group-hover/thread:invisible truncate">
							{totalCount > 1 ? "Last reply " : ""}
							{formatDistanceToNow(toDate(lastReplyAt), { addSuffix: false })} ago
						</span>
					)}
					{/* View thread - absolutely positioned on hover */}
					<span className="invisible absolute left-0 text-muted-fg group-hover/thread:visible">
						View thread
					</span>
				</span>
			</div>
		</button>
	)
}

/**
 * Stacked avatar component showing overlapping user avatars
 */
function AvatarStack({ authorIds }: { authorIds: UserId[] }) {
	if (authorIds.length === 0) return null

	return (
		<div className="flex items-center -space-x-1.5">
			{authorIds.map((authorId, index) => (
				<AvatarStackItem key={authorId} authorId={authorId} index={index} />
			))}
		</div>
	)
}

function AvatarStackItem({ authorId, index }: { authorId: UserId; index: number }) {
	const userPresenceResult = useAtomValue(userWithPresenceAtomFamily(authorId))
	const data = AsyncResult.getOrElse(userPresenceResult, () => [])
	const user = data[0]?.user
	const authorIdentity = useChatAuthorIdentity(authorId, user)

	if (!user) {
		return (
			<div className="size-5 rounded-md bg-muted ring-[1.5px] ring-bg" style={{ zIndex: 10 - index }} />
		)
	}

	return (
		<Avatar
			src={authorIdentity.avatarUrl}
			initials={authorIdentity.initials}
			seed={authorIdentity.seed}
			alt={authorIdentity.displayName}
			size="xxs"
			className="ring-[1.5px] ring-bg"
			isSquare
		/>
	)
}
