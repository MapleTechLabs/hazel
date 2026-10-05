"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { UserId } from "@hazel/schema"
import { memo, useState } from "react"
import { userWithPresenceAtomFamily } from "~/atoms/message-atoms"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { cn } from "~/lib/utils"

interface ReactionData {
	count: number
	users: string[]
	hasReacted: boolean
}

interface ReactionButtonProps {
	emoji: string
	data: ReactionData
	onReaction: (emoji: string) => void
	currentUserId?: string
	customEmojiImageUrl?: string
}

export const ReactionButton = memo(function ReactionButton({
	emoji,
	data,
	onReaction,
	currentUserId,
	customEmojiImageUrl,
}: ReactionButtonProps) {
	// Track tooltip open state to lazy-load user data
	const [isTooltipOpen, setIsTooltipOpen] = useState(false)

	return (
		<Tooltip delay={300} isOpen={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
			<TooltipTrigger
				onPress={() => onReaction(emoji)}
				className={cn(
					"inline-flex size-max cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium text-sm ring ring-inset transition-colors",
					data.hasReacted
						? "bg-primary/10 text-primary ring-primary/20 hover:bg-primary/20"
						: "bg-secondary text-fg ring-border hover:bg-secondary/80",
				)}
			>
				{customEmojiImageUrl ? (
					<img src={customEmojiImageUrl} alt={emoji} className="size-5 object-contain" />
				) : (
					emoji
				)}{" "}
				{data.count}
			</TooltipTrigger>
			<TooltipContent placement="top" className="flex items-center gap-3 px-3 py-2">
				{customEmojiImageUrl ? (
					<img src={customEmojiImageUrl} alt={emoji} className="size-7 object-contain" />
				) : (
					<span className="text-3xl">{emoji}</span>
				)}
				<span className="text-sm">
					{/* Only render user list (and subscribe to atoms) when tooltip is open */}
					{isTooltipOpen && <ReactionUserList userIds={data.users} currentUserId={currentUserId} />}
				</span>
			</TooltipContent>
		</Tooltip>
	)
})

interface ReactionUserListProps {
	userIds: string[]
	currentUserId?: string
}

function ReactionUserList({ userIds, currentUserId }: ReactionUserListProps) {
	if (userIds.length === 0) {
		return null
	}

	// Sort current user first
	const sortedUserIds = [...userIds].sort((a, b) => {
		if (a === currentUserId) return -1
		if (b === currentUserId) return 1
		return 0
	})

	const maxDisplayed = 3
	const displayedUserIds = sortedUserIds.slice(0, maxDisplayed)
	const remainingCount = sortedUserIds.length - maxDisplayed

	return (
		<>
			reacted by{" "}
			{displayedUserIds.map((userId, index) => (
				<span key={userId}>
					<UserName userId={userId as UserId} isCurrentUser={userId === currentUserId} />
					{index < displayedUserIds.length - 1 &&
					remainingCount <= 0 &&
					index === displayedUserIds.length - 2
						? " and "
						: index < displayedUserIds.length - 1
							? ", "
							: ""}
				</span>
			))}
			{remainingCount > 0 && (
				<span>
					, and {remainingCount} {remainingCount === 1 ? "other" : "others"}
				</span>
			)}
		</>
	)
}

interface UserNameProps {
	userId: UserId
	isCurrentUser: boolean
}

function UserName({ userId, isCurrentUser }: UserNameProps) {
	const userPresenceResult = useAtomValue(userWithPresenceAtomFamily(userId))
	const data = AsyncResult.getOrElse(userPresenceResult, () => [])
	const result = data[0]
	const user = result?.user

	if (isCurrentUser) {
		return <span>You</span>
	}

	if (!user) {
		return <span className="text-muted-fg">Loading...</span>
	}

	return <span>{`${user.firstName} ${user.lastName}`}</span>
}
