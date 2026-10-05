import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { Message, User } from "@hazel/domain/models"
import type { MessageId } from "@hazel/schema"
import { messageWithAuthorAtomFamily } from "~/atoms/message-atoms"
import { Avatar } from "../ui/avatar"
import { useChatAuthorIdentity } from "./author-identity"

interface MessageReplySectionProps {
	replyToMessageId: MessageId
	onClick?: () => void
}

type MessageWithAuthor = Message.Type & {
	author: User.Type
}

export function MessageReplySection({ replyToMessageId, onClick }: MessageReplySectionProps) {
	// Use atom for message with author - automatically deduplicated
	const messageResult = useAtomValue(messageWithAuthorAtomFamily(replyToMessageId))

	return (
		<div className="relative mb-1">
			{/* Reply curve SVG */}
			<svg
				className="absolute -bottom-1 left-5 rotate-90 text-muted-fg"
				xmlns="http://www.w3.org/2000/svg"
				width="24"
				height="20"
				viewBox="0 0 24 20"
				fill="none"
			>
				<path
					d="M2 2 L2 12 Q2 16 6 16 L12 16"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					fill="none"
				/>
			</svg>

			{/* Reply content */}
			<button
				type="button"
				className="flex w-fit items-center gap-1 pl-12 text-left hover:bg-transparent"
				onClick={onClick}
			>
				{AsyncResult.builder(messageResult)
					.onInitial(() => (
						<>
							<div className="size-4 animate-pulse rounded-full bg-muted" />
							<span className="text-muted-fg text-sm">Loading...</span>
						</>
					))
					.onSuccess((data) =>
						data ? (
							<LoadedReplySection data={data} />
						) : (
							<span className="text-muted-fg text-sm">Message not found</span>
						),
					)
					.onFailure(() => <span className="text-muted-fg text-sm">Message not found</span>)
					.render()}
			</button>
		</div>
	)
}

function LoadedReplySection({ data }: { data: MessageWithAuthor }) {
	const authorIdentity = useChatAuthorIdentity(data.authorId, data.author)

	return (
		<>
			<Avatar
				size="xs"
				src={authorIdentity.avatarUrl}
				initials={authorIdentity.initials}
				seed={authorIdentity.seed}
				alt={authorIdentity.displayName}
			/>
			<span className="font-medium text-fg text-sm hover:underline">{authorIdentity.displayName}</span>
			<span className="max-w-xs truncate text-ellipsis text-muted-fg text-sm">
				{data.content.split("\n")[0]}
			</span>
		</>
	)
}
