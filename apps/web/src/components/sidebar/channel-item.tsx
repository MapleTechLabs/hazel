import { useAtomSet } from "@effect/atom-react"
import type { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import type { DateTime } from "effect"
import { useNavigate } from "@tanstack/react-router"
import { memo } from "react"
import { useModal } from "~/atoms/modal-atoms"
import { ChannelIcon } from "~/components/channel-icon"
import type { PartnerOrgInfo } from "~/hooks/use-shared-channels"
import IconDots from "~/components/icons/icon-dots"
import { IconFolderPlus } from "~/components/icons/icon-folder-plus"
import IconGear from "~/components/icons/icon-gear"
import IconLeave from "~/components/icons/icon-leave"
import { IconStar } from "~/components/icons/icon-star"
import IconTrash from "~/components/icons/icon-trash"
import IconVolume from "~/components/icons/icon-volume"
import IconVolumeMute from "~/components/icons/icon-volume-mute"
import { ThreadItem } from "~/components/sidebar/thread-item"
import { Button } from "~/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSubMenu } from "~/components/ui/menu"
import { SidebarItem, SidebarLabel, SidebarLink, SidebarTreeItem } from "~/components/ui/sidebar"
import { moveChannelToSectionAction } from "~/db/actions"
import { useChannelMemberActions } from "~/hooks/use-channel-member-actions"
import { useOrganization } from "~/hooks/use-organization"
import { usePermission } from "~/hooks/use-permission"
import { useScrollIntoViewOnActive } from "~/hooks/use-scroll-into-view-on-active"
import { exitToastAsync } from "~/lib/toast-exit"

type DateLike = Date | DateTime.Utc

export interface SidebarChannelData {
	readonly id: ChannelId
	readonly name: string
	readonly type: "private" | "public" | "thread" | "direct" | "single"
	readonly icon: string | null
	readonly organizationId: OrganizationId
	readonly parentChannelId: ChannelId | null
	readonly sectionId: ChannelSectionId | null
	readonly updatedAt?: DateLike | null
}

export interface SidebarChannelMemberData {
	readonly id: ChannelMemberId
	readonly channelId: ChannelId
	readonly userId: UserId
	readonly isMuted: boolean
	readonly isFavorite: boolean
	readonly isHidden: boolean
	readonly notificationCount: number
}

interface ChannelItemProps {
	channel: SidebarChannelData
	member: SidebarChannelMemberData
	notificationCount?: number
	threads?: Array<{
		channel: SidebarChannelData
		member: SidebarChannelMemberData
	}>
	/** Available sections for "move to section" menu */
	sections?: Array<{ id: ChannelSectionId; name: string }>
	/** Partner orgs this channel is shared with via Hazel Connect */
	partnerOrgs?: PartnerOrgInfo[]
}

export const CHANNEL_DRAG_TYPE = "application/x-hazel-channel"

export const ChannelItem = memo(function ChannelItem({
	channel,
	member,
	notificationCount,
	threads,
	sections = [],
	partnerOrgs,
}: ChannelItemProps) {
	const deleteChannelModal = useModal("delete-channel")
	const { can } = usePermission()

	const { slug } = useOrganization()
	const navigate = useNavigate()
	const scrollRef = useScrollIntoViewOnActive(channel.id)

	const { handleToggleMute, handleToggleFavorite, handleLeave } = useChannelMemberActions(member, "channel")
	const moveChannelToSection = useAtomSet(moveChannelToSectionAction, {
		mode: "promiseExit",
	})

	const handleMoveToSection = async (sectionId: ChannelSectionId | null) => {
		// Don't do anything if already in the target section
		if (channel.sectionId === sectionId) return

		await exitToastAsync(
			moveChannelToSection({
				channelId: channel.id,
				sectionId,
			}),
		)
			.loading("Moving channel...")
			.successMessage(sectionId ? "Channel moved to section" : "Channel moved to default")
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Channel not found",
				description: "This channel may have been deleted.",
				isRetryable: false,
			}))
			.onErrorTag("ChannelSectionNotFoundError", () => ({
				title: "Section not found",
				description: "This section may have been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	const hasThreads = threads && threads.length > 0

	return (
		<>
			<SidebarTreeItem
				id={channel.id}
				textValue={channel.name}
				// hasChildItems={hasThreads}
				content={
					<SidebarItem
						tooltip={channel.name}
						badge={
							(notificationCount ?? member.notificationCount) > 0
								? (notificationCount ?? member.notificationCount)
								: undefined
						}
					>
						<SidebarLink
							ref={scrollRef}
							to="/$orgSlug/chat/$id"
							params={{ orgSlug: slug, id: channel.id }}
							activeProps={{
								className: "bg-sidebar-accent font-medium text-sidebar-accent-fg",
							}}
						>
							<span className="relative shrink-0">
								<ChannelIcon icon={channel.icon} />
								{(() => {
									const firstOrg = partnerOrgs?.[0]
									if (!firstOrg) return null
									return (
										<span className="absolute -right-1 -bottom-0.5 flex items-end -space-x-0.5">
											{firstOrg.logoUrl ? (
												<img
													src={firstOrg.logoUrl}
													alt=""
													className="size-2.5 rounded-sm object-cover ring-[1.5px] ring-sidebar"
												/>
											) : (
												<span className="flex size-2.5 items-center justify-center rounded-sm bg-muted text-[6px] font-semibold ring-[1.5px] ring-sidebar">
													{firstOrg.name[0]}
												</span>
											)}
											{partnerOrgs.length > 1 && (
												<span className="flex h-2.5 items-center rounded-sm bg-muted px-0.5 text-[7px] font-semibold leading-none ring-[1.5px] ring-sidebar">
													+{partnerOrgs.length - 1}
												</span>
											)}
										</span>
									)
								})()}
							</span>
							<SidebarLabel>{channel.name}</SidebarLabel>
						</SidebarLink>
						<Menu>
							<Button
								intent="plain"
								size="sq-xs"
								data-slot="menu-trigger"
								className="size-5 text-muted-fg"
							>
								<IconDots className="size-4" />
							</Button>
							<MenuContent placement="right top" className="w-42">
								<MenuItem onAction={handleToggleMute}>
									{member.isMuted ? (
										<IconVolume className="size-4" />
									) : (
										<IconVolumeMute className="size-4" />
									)}
									<MenuLabel>{member.isMuted ? "Unmute" : "Mute"}</MenuLabel>
								</MenuItem>
								<MenuItem onAction={handleToggleFavorite}>
									<IconStar
										className={
											member.isFavorite
												? "size-4 text-favorite"
												: "size-4 text-muted-fg"
										}
									/>
									<MenuLabel>{member.isFavorite ? "Unfavorite" : "Favorite"}</MenuLabel>
								</MenuItem>
								{sections.length > 0 && (
									<MenuSubMenu>
										<MenuItem>
											<IconFolderPlus className="size-4" />
											<MenuLabel>Move to section</MenuLabel>
										</MenuItem>
										<MenuContent>
											<MenuItem
												onAction={() => handleMoveToSection(null)}
												className={channel.sectionId === null ? "bg-accent" : ""}
											>
												<MenuLabel>Channels (Default)</MenuLabel>
											</MenuItem>
											{sections.map((section) => (
												<MenuItem
													key={section.id}
													onAction={() => handleMoveToSection(section.id)}
													className={
														channel.sectionId === section.id ? "bg-accent" : ""
													}
												>
													<MenuLabel>{section.name}</MenuLabel>
												</MenuItem>
											))}
										</MenuContent>
									</MenuSubMenu>
								)}
								<MenuSeparator />
								<MenuItem
									onAction={() =>
										navigate({
											to: "/$orgSlug/channels/$channelId/settings",
											params: { orgSlug: slug, channelId: channel.id },
										})
									}
								>
									<IconGear />
									<MenuLabel>Settings</MenuLabel>
								</MenuItem>
								{can("channel.delete") && (
									<MenuItem
										intent="danger"
										onAction={() =>
											deleteChannelModal.open({
												channelId: channel.id,
												channelName: channel.name,
											})
										}
									>
										<IconTrash />
										<MenuLabel>Delete</MenuLabel>
									</MenuItem>
								)}
								<MenuSeparator />
								<MenuItem intent="danger" onAction={handleLeave}>
									<IconLeave />
									<MenuLabel className="text-destructive">Leave</MenuLabel>
								</MenuItem>
							</MenuContent>
						</Menu>
					</SidebarItem>
				}
			>
				{/* Nested threads - passed as children, outside TreeItemContent */}
				{hasThreads &&
					threads.map((thread) => (
						<SidebarTreeItem
							key={thread.channel.id}
							id={thread.channel.id}
							textValue={thread.channel.name}
							content={<ThreadItem thread={thread.channel} member={thread.member} />}
						/>
					))}
			</SidebarTreeItem>
		</>
	)
})
