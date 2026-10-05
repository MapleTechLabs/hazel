import type { PinnedMessageId } from "@hazel/schema"
import { useNavigate } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { format } from "date-fns"
import { useCallback, useMemo } from "react"
import { toDate, toEpochMs } from "~/lib/utils"
import { messageCollection, pinnedMessageCollection, userCollection } from "~/db/collections"
import { useChatStable } from "~/hooks/use-chat"
import IconClose from "../icons/icon-close"
import IconPin from "../icons/icon-pin"
import { Button } from "../ui/button"
import { Popover, PopoverContent } from "../ui/popover"
import { UserProfilePopover } from "./user-profile-popover"

export function PinnedMessagesModal() {
	const { channelId, unpinMessage } = useChatStable()
	const navigate = useNavigate({
		from: "/$orgSlug/chat/$id/",
	})

	const { data: pinnedMessages } = useLiveQuery({
		query: (q) =>
			q
				.from({ pinned: pinnedMessageCollection })
				.where(({ pinned }) => eq(pinned.channelId, channelId))
				.innerJoin({ message: messageCollection }, ({ pinned, message }) =>
					eq(pinned.messageId, message.id),
				)
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.select(({ pinned, message, author }) => ({
					pinned,
					message: {
						...message,
						pinnedMessage: pinned,
						author: author,
					},
				}))
				.orderBy(({ pinned }) => pinned.pinnedAt, "desc"),
		queryKey: [channelId],
	})

	// Memoize sorted pins to avoid re-sorting on every render
	const sortedPins = useMemo(
		() =>
			[...(pinnedMessages || [])].sort(
				(a, b) => toEpochMs(a.pinned.pinnedAt) - toEpochMs(b.pinned.pinnedAt),
			),
		[pinnedMessages],
	)

	// Stable navigation callback
	// TODO: Implement scroll-to-message - see GitHub issue
	// For now, just navigate with messageId in search params (ready for when scroll is reimplemented)
	const goToMessage = useCallback(
		(messageId: string) => {
			navigate({
				search: {
					messageId,
				},
			})
		},
		[navigate],
	)

	// Stable unpin callback
	const handleUnpin = useCallback(
		(pinnedId: PinnedMessageId) => {
			unpinMessage(pinnedId)
		},
		[unpinMessage],
	)

	return (
		<Popover>
			<Button size="sm" intent="plain" aria-label="View pinned messages">
				<IconPin data-slot="icon" />
			</Button>

			<PopoverContent placement="bottom end" className="w-96 p-0">
				<div className="rounded-xl border border-border bg-bg shadow-lg">
					{/* Header */}
					<div className="flex items-center gap-2 border-border border-b px-4 py-3">
						<IconPin className="size-4 text-muted-fg" />
						<h3 className="font-semibold text-fg text-sm">Pinned Messages</h3>
						<span className="ml-auto rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-fg text-xs">
							{sortedPins.length} {sortedPins.length === 1 ? "pin" : "pins"}
						</span>
					</div>

					{/* Content */}
					<div className="max-h-[400px] overflow-y-auto">
						{sortedPins.length === 0 ? (
							<div className="px-4 py-8 text-center">
								<p className="text-muted-fg text-sm">No pinned messages yet</p>
								<p className="mt-1 text-muted-fg/60 text-xs">
									Pin important messages to keep them easily accessible
								</p>
							</div>
						) : (
							<div className="flex flex-col">
								{sortedPins.map((pinnedMessage) => {
									const user = pinnedMessage.message.author
									const isEdited =
										pinnedMessage.message.updatedAt &&
										toEpochMs(pinnedMessage.message.updatedAt) >
											toEpochMs(pinnedMessage.message.createdAt)

									return (
										<button
											key={pinnedMessage.pinned.messageId}
											onClick={() => goToMessage(pinnedMessage.pinned.messageId)}
											className="group relative w-full cursor-pointer border-border border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary"
											type="button"
										>
											{/* Unpin Button */}
											<button
												onClick={(e) => {
													e.stopPropagation()
													handleUnpin(pinnedMessage.pinned.id)
												}}
												className="absolute top-2 right-2 rounded p-1 opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
												aria-label="Unpin message"
												type="button"
											>
												<IconClose className="size-3.5 text-muted-fg" />
											</button>

											{/* Message Content */}
											<div className="flex gap-3 pr-8">
												<UserProfilePopover
													userId={pinnedMessage.message.authorId}
													userName={
														user
															? `${user.firstName} ${user.lastName}`
															: undefined
													}
													userAvatarUrl={user?.avatarUrl}
												/>
												<div className="min-w-0 flex-1">
													{/* Message Author Header */}
													<div className="flex items-baseline gap-2">
														<span className="font-semibold text-fg text-sm">
															{user
																? `${user.firstName} ${user.lastName}`
																: "Unknown"}
														</span>
														<span className="text-muted-fg text-xs">
															{format(
																toDate(pinnedMessage.message.createdAt),
																"HH:mm",
															)}
															{isEdited && " (edited)"}
														</span>
													</div>

													<p className="mt-1 line-clamp-2 text-muted-fg text-sm">
														{pinnedMessage.message.content}
													</p>
												</div>
											</div>

											{/* Pinned Date */}
											<div className="mt-2 text-muted-fg text-xs">
												Pinned{" "}
												{format(
													toDate(pinnedMessage.pinned.pinnedAt),
													"MMM d 'at' h:mm a",
												)}
											</div>
										</button>
									)
								})}
							</div>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
