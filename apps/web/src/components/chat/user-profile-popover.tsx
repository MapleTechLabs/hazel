import { IconChatBubble } from "~/components/icons/icon-chat-bubble"
import { IconClock } from "~/components/icons/icon-clock"
import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import type { UserId } from "@hazel/schema"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { Button as PrimitiveButton } from "react-aria-components"
import { toast } from "sonner"
import { userWithPresenceAtomFamily } from "~/atoms/message-atoms"
import { presenceNowSignal } from "~/atoms/presence-atoms"
import IconDotsVertical from "~/components/icons/icon-dots-vertical"
import IconPhone from "~/components/icons/icon-phone"
import { Avatar } from "~/components/ui/avatar"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { DropdownLabel, DropdownSeparator } from "~/components/ui/dropdown"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/ui/menu"
import { Popover, PopoverContent } from "~/components/ui/popover"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { cn } from "~/lib/utils"
import type { PresenceStatus } from "~/utils/status"
import { formatStatusExpiration, getStatusDotColor, getStatusLabel } from "~/utils/status"
import { formatUserLocalTime, getTimezoneAbbreviation } from "~/utils/timezone"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { useChatAuthorIdentity } from "./author-identity"

interface UserProfilePopoverProps {
	userId: UserId
	/** Display name for the avatar trigger — avoids subscribing to atoms */
	userName?: string
	/** Avatar URL for the trigger — avoids subscribing to atoms */
	userAvatarUrl?: string | null
}

/**
 * Popover trigger that renders only an avatar.
 * Accepts display data as props so it has ZERO atom subscriptions.
 * All data-fetching lives in PopoverBody which only mounts when open.
 */
export function UserProfilePopover({ userId, userName, userAvatarUrl }: UserProfilePopoverProps) {
	const displayName = userName || ""

	return (
		<Popover>
			<PrimitiveButton className="size-fit outline-hidden">
				<Avatar size="md" alt={displayName} src={userAvatarUrl} seed={displayName} />
			</PrimitiveButton>
			<PopoverContent placement="right top" className="w-72 p-0 lg:w-80">
				<PopoverBody userId={userId} />
			</PopoverContent>
		</Popover>
	)
}

/**
 * Inner popover content — only rendered when the popover is open.
 * Subscribes to all necessary atoms (user data, presence, presenceNowSignal).
 */
function PopoverBody({ userId }: { userId: UserId }) {
	const { user: currentUser } = useAuth()
	const navigate = useNavigate()
	const { slug: orgSlug } = useOrganization()
	const nowMs = useAtomValue(presenceNowSignal)

	const userPresenceResult = useAtomValue(userWithPresenceAtomFamily(userId))
	const data = AsyncResult.getOrElse(userPresenceResult, () => [])
	const result = data[0]
	const user = result?.user
	const presence = result?.presence
	const effectiveStatus = getEffectivePresenceStatus(presence ?? null, nowMs)
	const authorIdentity = useChatAuthorIdentity(userId, user)

	const [isFavorite, setIsFavorite] = useState(false)
	const [isMuted, setIsMuted] = useState(false)

	const isBot = authorIdentity.isBot
	const fullName = authorIdentity.displayName

	// Local time display - updates every minute
	const [localTime, setLocalTime] = useState(() =>
		user?.timezone ? formatUserLocalTime(user.timezone) : "",
	)

	// Sync local time when timezone changes (render-time adjustment)
	const prevTimezoneRef = useRef(user?.timezone)
	if (user?.timezone !== prevTimezoneRef.current) {
		prevTimezoneRef.current = user?.timezone
		if (user?.timezone) {
			setLocalTime(formatUserLocalTime(user.timezone))
		}
	}

	useEffect(() => {
		if (!user?.timezone) return

		// Update every minute
		const interval = setInterval(() => {
			setLocalTime(formatUserLocalTime(user.timezone))
		}, 60000)

		return () => clearInterval(interval)
	}, [user?.timezone])

	if (!user) return null

	const isOwnProfile = currentUser?.id === userId

	const handleCopyUserId = () => {
		navigator.clipboard.writeText(user.id)
		toast.success("User ID copied!", {
			description: "User ID has been copied to your clipboard.",
		})
	}

	const handleToggleFavorite = () => {
		setIsFavorite(!isFavorite)
		toast.success(isFavorite ? "Removed from favorites" : "Added to favorites", {
			description: isFavorite
				? `${fullName} has been removed from your favorites.`
				: `${fullName} has been added to your favorites.`,
		})
	}

	const handleToggleMute = () => {
		setIsMuted(!isMuted)
		toast.success(isMuted ? "Unmuted" : "Muted", {
			description: isMuted
				? `You will now receive notifications from ${fullName}.`
				: `You will no longer receive notifications from ${fullName}.`,
		})
	}

	const handleCall = () => {
		toast.info("Calling...", {
			description: `Starting call with ${fullName}`,
		})
	}

	const getStatusBadgeIntent = (status: PresenceStatus) => {
		switch (status) {
			case "online":
				return "success"
			case "away":
				return "warning"
			case "dnd":
				return "danger"
			case "offline":
			default:
				return "secondary"
		}
	}

	return (
		<>
			{/* Banner with layered gradient */}
			<div
				className={cn(
					"relative h-20 overflow-hidden rounded-t-xl",
					"bg-gradient-to-br from-primary/20 via-accent/10 to-transparent",
					"before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_30%_20%,var(--color-primary)/15_0%,transparent_50%)]",
				)}
			/>

			{/* Main content card */}
			<div className="relative rounded-t-xl border border-border bg-bg shadow-md">
				{/* Centered avatar overlapping banner */}
				<div className="absolute left-1/2 -top-10 -translate-x-1/2">
					<div className="relative">
						<Avatar
							size="3xl"
							className="shadow-lg shadow-black/5 ring-[5px] ring-bg"
							alt={fullName}
							src={authorIdentity.avatarUrl}
							seed={authorIdentity.seed}
							isSquare={isBot}
						/>
						{!isBot && (
							<span
								className={cn(
									"absolute right-1 bottom-1 size-4 rounded-full border-[3px] border-bg",
									getStatusDotColor(effectiveStatus),
								)}
							/>
						)}
					</div>
				</div>

				{/* Identity section - centered below avatar */}
				<div className="flex flex-col items-center gap-1 pt-12 text-center">
					<div className="flex items-center gap-2">
						<span className="text-lg font-semibold text-fg">{fullName}</span>
						{isBot && (
							<Badge intent="primary" size="sm">
								APP
							</Badge>
						)}
					</div>
					{!isBot && <span className="text-sm text-muted-fg">{user.email}</span>}
					{!isBot && effectiveStatus !== "online" && (
						<Badge intent={getStatusBadgeIntent(effectiveStatus)} size="sm" className="mt-1">
							{getStatusLabel(effectiveStatus)}
						</Badge>
					)}
				</div>

				{/* Custom status section - only for non-bots */}
				{!isBot && (presence?.statusEmoji || presence?.customMessage) && (
					<div className="mx-4 mt-3 rounded-lg bg-secondary/50 p-3">
						<div className="flex items-start gap-2">
							{presence.statusEmoji && <span className="text-lg">{presence.statusEmoji}</span>}
							<div className="flex flex-col gap-0.5">
								{presence.customMessage && (
									<span className="text-sm text-fg">{presence.customMessage}</span>
								)}
								{presence.statusExpiresAt && (
									<span className="text-xs text-muted-fg">
										Until {formatStatusExpiration(presence.statusExpiresAt)}
									</span>
								)}
							</div>
						</div>
					</div>
				)}

				{/* Meta info section - only for non-bots */}
				{!isBot && user.timezone && localTime && (
					<div className="mt-3 px-4">
						<div className="flex items-center justify-center gap-2 text-sm text-muted-fg">
							<IconClock className="size-4 opacity-60" />
							<span>
								{localTime} ({getTimezoneAbbreviation(user.timezone)})
							</span>
						</div>
					</div>
				)}

				{/* Action bar at bottom */}
				<div className="mt-4 flex items-center gap-2 border-t border-border px-4 py-3">
					{isOwnProfile ? (
						<Button
							size="sm"
							intent="primary"
							className="flex-1"
							onPress={() => {
								navigate({
									to: "/$orgSlug/my-settings/profile",
									params: { orgSlug },
								})
							}}
						>
							Edit profile
						</Button>
					) : (
						<>
							<Button size="sm" intent="primary" className="flex-1">
								<IconChatBubble data-slot="icon" />
								Message
							</Button>
							{!isBot && (
								<Button
									size="sq-sm"
									intent="secondary"
									onPress={handleCall}
									aria-label="Call"
								>
									<IconPhone data-slot="icon" />
								</Button>
							)}
							<Menu>
								<MenuTrigger>
									<Button size="sq-sm" intent="secondary" aria-label="More options">
										<IconDotsVertical data-slot="icon" />
									</Button>
								</MenuTrigger>
								<MenuContent placement="top end">
									<MenuItem onAction={handleToggleFavorite}>
										<DropdownLabel>
											{isFavorite ? "Remove from favorites" : "Add to favorites"}
										</DropdownLabel>
									</MenuItem>
									<MenuItem onAction={handleToggleMute}>
										<DropdownLabel>{isMuted ? "Unmute" : "Mute"}</DropdownLabel>
									</MenuItem>
									<DropdownSeparator />
									<MenuItem onAction={handleCopyUserId}>
										<DropdownLabel>Copy user ID</DropdownLabel>
									</MenuItem>
								</MenuContent>
							</Menu>
						</>
					)}
				</div>
			</div>
		</>
	)
}
