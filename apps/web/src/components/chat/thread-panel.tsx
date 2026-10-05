import { useAtomSet } from "@effect/atom-react"
import type { ChannelId, MessageId, OrganizationId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { format } from "date-fns"
import { toDate } from "~/lib/utils"
import { generateThreadNameMutation } from "~/atoms/channel-atoms"
import { exitToast } from "~/lib/toast-exit"
import { channelCollection } from "~/db/collections"
import { useMessage } from "~/db/hooks"
import { useSingleModalState } from "~/hooks/use-modal-state"
import { ChatProvider } from "~/providers/chat-provider"
import IconClose from "../icons/icon-close"
import IconEdit from "../icons/icon-edit"
import IconPenSparkle from "../icons/icon-pen-sparkle"
import { RenameThreadModal } from "../modals/rename-thread-modal"
import { Avatar } from "../ui/avatar"
import { Button } from "../ui/button"
import { Loader } from "../ui/loader"
import { Tooltip, TooltipContent } from "../ui/tooltip"
import { useChatAuthorIdentity } from "./author-identity"
import { SlateMessageComposer } from "./slate-editor/slate-message-composer"
import { SlateMessageViewer } from "./slate-editor/slate-message-viewer"
import { ThreadMessageList } from "./thread-message-list"
import { TypingIndicator } from "./typing-indicator"

interface ThreadPanelProps {
	threadChannelId: ChannelId
	originalMessageId: MessageId
	organizationId: OrganizationId
	onClose: () => void
	isCreating?: boolean
}

function ThreadContent({
	threadChannelId,
	originalMessageId,
	organizationId,
	onClose,
	isCreating,
}: ThreadPanelProps) {
	const { data: originalMessage } = useMessage(originalMessageId)
	const renameModal = useSingleModalState()
	const [isGenerating, setIsGenerating] = React.useState(false)

	const generateName = useAtomSet(generateThreadNameMutation, { mode: "promiseExit" })
	const authorIdentity = useChatAuthorIdentity(originalMessage?.authorId, originalMessage?.author)

	const { data: threadData } = useLiveQuery({
		query: (q) => q.from({ channel: channelCollection }).where((q) => eq(q.channel.id, threadChannelId)),
		queryKey: [threadChannelId],
	})

	const thread = threadData?.[0]
	const threadName = thread?.name || "Thread"

	const handleGenerateName = async () => {
		setIsGenerating(true)
		const exit = await generateName({ payload: { channelId: threadChannelId } })
		setIsGenerating(false)

		exitToast(exit)
			// Backend validation errors (non-common)
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Thread not found",
				description: "This thread may have been deleted.",
				isRetryable: false,
			}))
			.onErrorTag("MessageNotFoundError", () => ({
				title: "Original message not found",
				description: "The message that started this thread could not be found.",
				isRetryable: false,
			}))
			// Workflow resource errors (common - override with context-specific messages)
			.onCommonErrorTag("ThreadChannelNotFoundError", () => ({
				title: "Thread not found",
				description: "This thread may have been deleted.",
				isRetryable: false,
			}))
			.onCommonErrorTag("OriginalMessageNotFoundError", () => ({
				title: "Message not found",
				description: "The original message could not be found.",
				isRetryable: false,
			}))
			.onCommonErrorTag("ThreadContextQueryError", () => ({
				title: "Database error",
				description: "Failed to load thread data. Please try again.",
				isRetryable: true,
			}))
			// AI errors (common - override with context-specific messages)
			.onCommonErrorTag("AIProviderUnavailableError", () => ({
				title: "AI service unavailable",
				description: "The AI service is temporarily unavailable. Please try again later.",
				isRetryable: true,
			}))
			.onCommonErrorTag("AIRateLimitError", () => ({
				title: "AI rate limited",
				description: "Please wait a moment and try again.",
				isRetryable: true,
			}))
			.onCommonErrorTag("AIResponseParseError", () => ({
				title: "AI response error",
				description: "The AI returned an unexpected response. Please try again.",
				isRetryable: true,
			}))
			// Update error (common - override with context-specific message)
			.onCommonErrorTag("ThreadNameUpdateError", () => ({
				title: "Update failed",
				description: "Failed to save the thread name. Please try again.",
				isRetryable: true,
			}))
			// Service unavailable (common - override with context-specific message)
			.onCommonErrorTag("WorkflowServiceUnavailableError", () => ({
				title: "Service temporarily unavailable",
				description: "Please try again later.",
				isRetryable: true,
			}))
			.run()
	}

	return (
		<div className="flex h-full flex-col border-border border-l bg-bg">
			{/* Thread Header */}
			<div className="flex items-center justify-between border-border border-b bg-bg px-4 py-3">
				<div className="flex items-center gap-2">
					<h2 className="font-semibold text-fg">{threadName}</h2>
				</div>
				<div className="flex items-center gap-1">
					<Tooltip>
						<Button
							intent="plain"
							size="sq-sm"
							onPress={handleGenerateName}
							isDisabled={isGenerating}
							aria-label="Generate thread name"
							className="rounded p-1 hover:bg-secondary"
						>
							{isGenerating ? (
								<Loader className="size-4" />
							) : (
								<IconPenSparkle data-slot="icon" className="size-4" />
							)}
						</Button>
						<TooltipContent>Generate name</TooltipContent>
					</Tooltip>
					<Tooltip>
						<Button
							intent="plain"
							size="sq-sm"
							onPress={renameModal.open}
							aria-label="Rename thread"
							className="rounded p-1 hover:bg-secondary"
						>
							<IconEdit data-slot="icon" className="size-4" />
						</Button>
						<TooltipContent>Rename</TooltipContent>
					</Tooltip>
					<Button
						intent="plain"
						size="sq-sm"
						onPress={onClose}
						aria-label="Close thread"
						className="rounded p-1 hover:bg-secondary"
					>
						<IconClose data-slot="icon" className="size-4" />
					</Button>
				</div>
			</div>

			{/* Original Message */}
			{originalMessage && (
				<div className="border-border border-b bg-secondary px-4 py-3">
					<div className="flex gap-3">
						<Avatar
							src={authorIdentity.avatarUrl}
							initials={authorIdentity.initials}
							seed={authorIdentity.seed}
							alt={authorIdentity.displayName}
							className="size-9"
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline gap-2">
								<span className="font-medium text-fg text-sm">
									{authorIdentity.displayName}
								</span>
								<span className="text-muted-fg text-xs">
									{format(toDate(originalMessage.createdAt), "MMM d, HH:mm")}
								</span>
							</div>
							<div className="mt-1">
								<SlateMessageViewer
									content={originalMessage.content}
									organizationId={organizationId}
								/>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Thread Messages */}
			<div className="flex-1 overflow-hidden bg-bg">
				<ThreadMessageList threadChannelId={threadChannelId} />
			</div>

			{/* Thread Composer */}
			<div className="border-border border-t bg-bg px-4 py-3">
				{isCreating ? (
					<div className="flex items-center justify-center gap-2 py-3 text-muted-fg text-sm">
						<Loader className="size-4" />
						Creating thread...
					</div>
				) : (
					<>
						<SlateMessageComposer placeholder="Reply in thread..." />
						<TypingIndicator />
					</>
				)}
			</div>

			<RenameThreadModal
				threadId={threadChannelId}
				isOpen={renameModal.isOpen}
				onOpenChange={renameModal.setIsOpen}
			/>
		</div>
	)
}

import React from "react"

export function ThreadPanel({
	threadChannelId,
	originalMessageId,
	onClose,
	organizationId,
	isCreating,
}: ThreadPanelProps) {
	return (
		<ChatProvider channelId={threadChannelId} organizationId={organizationId}>
			<ThreadContent
				organizationId={organizationId}
				threadChannelId={threadChannelId}
				originalMessageId={originalMessageId}
				onClose={onClose}
				isCreating={isCreating}
			/>
		</ChatProvider>
	)
}
