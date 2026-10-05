import type { User } from "@hazel/domain/models"
import type { ChannelId, UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Link } from "@tanstack/react-router"
import { ChannelIcon } from "~/components/channel-icon"
import { IconChevronRight } from "~/components/icons/icon-chevron-right"
import { Avatar } from "~/components/ui/avatar"
import { Button } from "~/components/ui/button"
import { useSidebar } from "~/components/ui/sidebar"
import { Tooltip, TooltipContent } from "~/components/ui/tooltip"
import { channelCollection } from "~/db/collections"
import { useChannelWithCurrentUser, useParentChannel } from "~/db/hooks"
import { useChannelMemberActions } from "~/hooks/use-channel-member-actions"
import { useChatStable } from "~/hooks/use-chat"
import { useOrganization } from "~/hooks/use-organization"
import { useSharedChannels } from "~/hooks/use-shared-channels"
import { useAuth } from "~/lib/auth"
import IconEye from "../icons/icon-eye"
import { IconMenu } from "../icons/icon-menu"
import IconThread from "../icons/icon-thread"
import { useChatAuthorIdentity } from "./author-identity"
import { PinnedMessagesModal } from "./pinned-messages-modal"

interface OtherMemberAvatarProps {
	member: {
		userId: UserId
		user: Pick<User.Type, "avatarUrl" | "firstName" | "lastName" | "userType">
	}
}

function OtherMemberAvatar({ member }: OtherMemberAvatarProps) {
	const authorIdentity = useChatAuthorIdentity(member.userId, member.user)

	return (
		<Avatar
			size="sm"
			src={authorIdentity.avatarUrl}
			initials={authorIdentity.initials}
			seed={authorIdentity.seed}
			alt={authorIdentity.displayName}
		/>
	)
}

function OtherMemberName({ member }: OtherMemberAvatarProps) {
	const authorIdentity = useChatAuthorIdentity(member.userId, member.user)
	return <>{authorIdentity.displayName}</>
}

export function ChatHeader() {
	const { channelId } = useChatStable()
	const { user } = useAuth()
	const { channel } = useChannelWithCurrentUser(channelId)
	const { isMobile, setIsOpenOnMobile } = useSidebar()
	const { slug, organizationId } = useOrganization()

	const sharedChannels = useSharedChannels(organizationId)
	const partnerOrgs = sharedChannels.get(channelId)

	const { handleToggleHidden } = useChannelMemberActions(channel?.currentUser, "conversation")

	// Fallback query for channel data when user is not a member
	const { data: channelFallback } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel: c }) => eq(c.id, channelId))
				.findOne()
				.select(({ channel: c }) => ({ ...c })),
		queryKey: [channelId],
	})

	// Determine if this is a thread and fetch parent channel data
	const isThread = channel?.type === "thread"
	const { parentChannel } = useParentChannel(isThread ? (channel.parentChannelId ?? null) : null)

	if (!channel) {
		return (
			<div className="flex h-14 shrink-0 items-center border-border border-b bg-bg px-4">
				{isMobile && (
					<Button
						intent="plain"
						size="sq-xs"
						onPress={() => setIsOpenOnMobile(true)}
						className="mr-3 -ml-1"
					>
						<IconMenu className="size-5" />
					</Button>
				)}
				{channelFallback ? (
					<div className="flex items-center gap-3">
						<ChannelIcon icon={channelFallback.icon} className="size-5 text-muted-fg" />
						<h2 className="font-semibold text-fg text-sm">{channelFallback.name}</h2>
					</div>
				) : (
					<div className="h-4 w-32 animate-pulse rounded-sm bg-secondary" />
				)}
			</div>
		)
	}

	const isDirectMessage = channel.type === "direct" || channel.type === "single"
	const otherMembers = (channel.members ?? []).filter((member) => member.userId !== user?.id)

	return (
		<div className="flex h-14 shrink-0 items-center justify-between border-border border-b bg-bg px-4">
			<div className="flex items-center gap-3">
				{isMobile && (
					<Button
						intent="plain"
						size="sq-xs"
						onPress={() => setIsOpenOnMobile(true)}
						className="-ml-1"
					>
						<IconMenu className="size-5" />
					</Button>
				)}
				{isThread ? (
					<div className="flex items-center gap-2">
						{/* Parent channel link */}
						{parentChannel && channel.parentChannelId && (
							<Link
								to="/$orgSlug/chat/$id"
								params={{ orgSlug: slug, id: channel.parentChannelId }}
								className="flex items-center gap-1.5 text-muted-fg transition-colors hover:text-fg"
							>
								<ChannelIcon icon={parentChannel.icon} className="size-4" />
								<span className="text-sm">{parentChannel.name}</span>
							</Link>
						)}

						{/* Breadcrumb separator */}
						<IconChevronRight className="size-4 shrink-0 text-muted-fg" />

						{/* Thread indicator with name */}
						<div className="flex items-center gap-1.5">
							<IconThread className="size-4 shrink-0 text-muted-fg" />
							<h2 className="truncate font-semibold text-fg text-sm">{channel.name}</h2>
						</div>
					</div>
				) : isDirectMessage ? (
					<>
						{otherMembers && otherMembers.length > 0 && otherMembers[0] && (
							<OtherMemberAvatar member={otherMembers[0]} />
						)}
						<div>
							<h2 className="font-semibold text-fg text-sm">
								{otherMembers.length > 0 ? (
									otherMembers.slice(0, 3).map((member, index) => (
										<span key={member.userId}>
											{index > 0 ? ", " : null}
											<OtherMemberName member={member} />
										</span>
									))
								) : (
									<>Direct Message</>
								)}{" "}
								{otherMembers.length > 3 && (
									<span className="font-normal text-muted-fg text-xs">
										{` +${otherMembers.length - 3} more`}
									</span>
								)}
							</h2>
						</div>
					</>
				) : (
					<>
						<ChannelIcon icon={channel.icon} className="size-5 text-muted-fg" />
						<div className="flex items-center gap-2">
							<h2 className="font-semibold text-fg text-sm">{channel.name}</h2>
						</div>
						{partnerOrgs && partnerOrgs.length > 0 && (
							<div className="flex items-center gap-1.5 border-border border-l pl-3">
								{partnerOrgs.map((org) => (
									<Tooltip key={org.id} delay={100} closeDelay={20}>
										{org.logoUrl ? (
											<img
												src={org.logoUrl}
												alt={org.name}
												className="size-4 rounded-sm object-cover"
											/>
										) : (
											<span className="flex size-4 items-center justify-center rounded-sm bg-muted text-[8px] font-semibold">
												{org.name[0]}
											</span>
										)}
										<TooltipContent>{org.name}</TooltipContent>
									</Tooltip>
								))}
							</div>
						)}
					</>
				)}
			</div>

			<div className="flex items-center gap-2">
				{isDirectMessage && channel.currentUser?.isHidden && (
					<Tooltip delay={100} closeDelay={20}>
						<Button intent="plain" onPress={handleToggleHidden} aria-label="Unhide conversation">
							<IconEye />
						</Button>
						<TooltipContent>Unhide conversation</TooltipContent>
					</Tooltip>
				)}
				<PinnedMessagesModal />
			</div>
		</div>
	)
}
