"use client"

import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { UserId } from "@hazel/schema"
import { Button as PrimitiveButton } from "react-aria-components"
import type { RenderElementProps } from "slate-react"
import { useFocused, useSelected } from "slate-react"
import { userWithPresenceAtomFamily } from "~/atoms/message-atoms"
import { presenceNowSignal } from "~/atoms/presence-atoms"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { Popover, PopoverContent } from "~/components/ui/popover"
import { useBotName } from "~/db/hooks"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusDotColor } from "~/utils/status"
import type { MentionElement as MentionElementType } from "./slate-mention-plugin"

interface MentionElementProps extends RenderElementProps {
	element: MentionElementType
	/** Whether to make mentions interactive (clickable) */
	interactive?: boolean
}

/**
 * Element renderer for mention nodes (void inline elements)
 * Renders mentions as non-editable inline chips following Slate's official pattern
 */
export function MentionElement({ attributes, children, element, interactive = false }: MentionElementProps) {
	const selected = useSelected()
	const focused = useFocused()
	const nowMs = useAtomValue(presenceNowSignal)

	// Detect special mentions (@channel, @here)
	const isSpecialMention = element.userId === "channel" || element.userId === "here"
	const userId = isSpecialMention ? undefined : element.userId

	// Determine if we should fetch user data
	const shouldFetchUser = userId && !isSpecialMention

	// IMPORTANT: Hooks must be called unconditionally
	// Always call hooks in the same order, but only use the result if needed
	const userPresenceResult = useAtomValue(
		userWithPresenceAtomFamily((shouldFetchUser ? userId : "dummy-id") as UserId),
	)
	const data =
		shouldFetchUser && userPresenceResult ? AsyncResult.getOrElse(userPresenceResult, () => []) : []
	const result = data[0]
	const user = result?.user
	const presence = result?.presence
	const effectiveStatus = getEffectivePresenceStatus(presence ?? null, nowMs)

	// For machine users (bots), prefer bot.name as the source of truth
	const botName = useBotName(userId as UserId | undefined, user?.userType)

	// For special mentions (@channel, @here), use displayName
	if (isSpecialMention) {
		return (
			<span
				{...attributes}
				contentEditable={false}
				className={cn(
					"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary transition-colors",
					selected && focused && "ring-2 ring-primary ring-offset-1",
				)}
			>
				@{element.displayName}
				{children}
			</span>
		)
	}

	// For regular mentions, fetch display name from user data
	// Prefer bot.name for machine users to avoid stale user.firstName
	const fullName = botName ?? (user ? `${user.firstName} ${user.lastName}` : element.displayName)

	// If not interactive, just render the mention text without popover
	if (!interactive) {
		return (
			<span
				{...attributes}
				contentEditable={false}
				className={cn(
					"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary transition-colors hover:bg-primary/20",
					selected && focused && "ring-2 ring-primary ring-offset-1",
				)}
			>
				@{fullName}
				{children}
			</span>
		)
	}

	// Render interactive mention with popover
	return (
		<Popover>
			<PrimitiveButton
				{...attributes}
				className={cn(
					"inline-block cursor-pointer rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary outline-hidden transition-colors hover:bg-primary/20",
					selected && focused && "ring-2 ring-primary ring-offset-1",
				)}
			>
				@{fullName}
				{children}
			</PrimitiveButton>

			<PopoverContent placement="top" className="w-64 p-0">
				<div className="space-y-3 p-4">
					{/* User header */}
					<div className="flex items-center gap-3">
						{/* Avatar with status */}
						<div className="relative shrink-0">
							<Avatar size="md" alt={fullName} src={user?.avatarUrl || ""} seed={fullName} />
							<span
								className={cn(
									"absolute right-0 bottom-0 size-3 rounded-full border-2 border-bg",
									getStatusDotColor(effectiveStatus),
								)}
							/>
						</div>

						{/* User info */}
						<div className="min-w-0 flex-1">
							<div className="truncate font-semibold text-sm">{fullName}</div>
							{user && <div className="truncate text-muted-fg text-xs">{user.email}</div>}
						</div>
					</div>

					{/* Custom status message */}
					{presence?.customMessage && (
						<div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
							{presence.customMessage}
						</div>
					)}

					{/* Action button */}
					<Button size="sm" intent="primary" className="w-full">
						Send Message
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}
