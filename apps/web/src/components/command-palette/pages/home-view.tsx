"use client"

import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { and, eq, inArray, or, useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"
import type { CommandPalettePageType } from "~/atoms/command-palette-state"
import { useModal } from "~/atoms/modal-atoms"
import { MAX_RECENT_CHANNELS, recentChannelsAtom } from "~/atoms/recent-channels-atom"
import { ChannelIcon } from "~/components/channel-icon"
import IconBell from "~/components/icons/icon-bell"
import IconCircleDottedUser from "~/components/icons/icon-circle-dotted-user"
import IconDashboard from "~/components/icons/icon-dashboard"
import IconGear from "~/components/icons/icon-gear"
import IconIntegration from "~/components/icons/icon-integratio-"
import IconMagnifier from "~/components/icons/icon-magnifier-3"
import IconMsgs from "~/components/icons/icon-msgs"
import IconPlus from "~/components/icons/icon-plus"
import { IconServers } from "~/components/icons/icon-servers"
import IconUsersPlus from "~/components/icons/icon-users-plus"
import { Avatar } from "~/components/ui/avatar"
import {
	CommandMenuItem,
	CommandMenuLabel,
	CommandMenuSection,
	CommandMenuShortcut,
} from "~/components/ui/command-menu"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import { channelMemberWithUserCollection } from "~/db/materialized-collections"
import { useAppHotkeyLabel } from "~/hooks/use-app-hotkey"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"

interface HomeViewProps {
	navigateToPage: (page: CommandPalettePageType) => void
	onClose: () => void
}

export function HomeView({ navigateToPage, onClose }: HomeViewProps) {
	const { slug: orgSlug, organizationId } = useOrganization()
	const { user } = useAuth()
	const navigate = useNavigate()
	const recentChannels = useAtomValue(recentChannelsAtom)
	const setRecentChannels = useAtomSet(recentChannelsAtom)

	// Track a channel as recently accessed when clicking in command palette
	const trackChannel = useCallback(
		(channelId: string) => {
			setRecentChannels((channels) => {
				const filtered = channels.filter((c) => c.channelId !== channelId)
				return [{ channelId, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT_CHANNELS)
			})
		},
		[setRecentChannels],
	)

	// Modal hooks for quick actions (only for those not inline)
	const createDmModal = useModal("create-dm")
	const emailInviteModal = useModal("email-invite")
	const searchHotkeyLabel = useAppHotkeyLabel("search.open")
	const createChannelHotkeyLabel = useAppHotkeyLabel("channel.create")
	const createDmHotkeyLabel = useAppHotkeyLabel("dm.create")
	const inviteHotkeyLabel = useAppHotkeyLabel("invite.email")

	// Get channel data for recent channels (memoized to prevent infinite re-renders)
	const recentChannelIds = useMemo(() => recentChannels.map((rc) => rc.channelId), [recentChannels])

	const { data: recentChannelData } = useLiveQuery({
		query: (q) =>
			recentChannelIds.length > 0 && organizationId
				? q
						.from({ channel: channelCollection })
						.where(({ channel }) =>
							and(
								eq(channel.organizationId, organizationId),
								inArray(channel.id, recentChannelIds),
							),
						)
						.select(({ channel }) => ({ ...channel }))
				: null,
		queryKey: [recentChannelIds, organizationId],
	})

	// Sort and filter recent channels by visitedAt order
	const sortedRecentChannels = useMemo(() => {
		if (!recentChannelData) return []
		return recentChannels
			.map((rc) => recentChannelData.find((c) => c.id === rc.channelId))
			.filter((c): c is NonNullable<typeof c> => c !== undefined)
			.slice(0, 3)
	}, [recentChannelData, recentChannels])

	// Query all user channels (public/private) for search
	const { data: allChannels } = useLiveQuery({
		query: (q) =>
			organizationId && user?.id
				? q
						.from({ channel: channelCollection })
						.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
							eq(member.channelId, channel.id),
						)
						.where((q) =>
							and(
								eq(q.channel.organizationId, organizationId),
								or(eq(q.channel.type, "public"), eq(q.channel.type, "private")),
								eq(q.member.userId, user.id),
								eq(q.member.isHidden, false),
							),
						)
						.orderBy(({ channel }) => channel.name, "asc")
				: null,
		queryKey: [organizationId, user?.id],
	})

	// Query DM channels with all members for search
	const { data: dmChannelData } = useLiveQuery({
		query: (q) =>
			organizationId && user?.id
				? q
						.from({ channel: channelCollection })
						.innerJoin({ member: channelMemberWithUserCollection }, ({ channel, member }) =>
							eq(member.channelId, channel.id),
						)
						.where((q) =>
							and(
								eq(q.channel.organizationId, organizationId),
								or(eq(q.channel.type, "single"), eq(q.channel.type, "direct")),
							),
						)
				: null,
		queryKey: [organizationId, user?.id],
	})

	// Process DM data to group by channel and get other members
	const dmChannels = useMemo(() => {
		if (!dmChannelData || !user?.id) return []

		// Group by channel, collect members
		const channelMap = new Map<
			string,
			{
				channel: (typeof dmChannelData)[0]["channel"]
				members: (typeof dmChannelData)[0]["member"][]
			}
		>()
		for (const row of dmChannelData) {
			const existing = channelMap.get(row.channel.id) || { channel: row.channel, members: [] }
			existing.members.push(row.member)
			channelMap.set(row.channel.id, existing)
		}

		// Filter to channels where current user is a member
		return Array.from(channelMap.values())
			.filter(({ members }) => members.some((m) => m.userId === user.id))
			.map(({ channel, members }) => ({
				...channel,
				// Filter out current user from display
				otherMembers: members.filter((m) => m.userId !== user.id),
			}))
	}, [dmChannelData, user])

	return (
		<>
			{/* Recent Channels */}
			{sortedRecentChannels.length > 0 && (
				<CommandMenuSection label="Recent">
					{sortedRecentChannels.map((channel) => {
						const isDm = channel.type === "direct" || channel.type === "single"
						const dmData = isDm ? dmChannels.find((dm) => dm.id === channel.id) : null

						if (isDm && dmData) {
							const firstMember = dmData.otherMembers[0]
							const displayName =
								dmData.type === "single" && dmData.otherMembers.length === 1 && firstMember
									? `${firstMember.user.firstName} ${firstMember.user.lastName}`
									: dmData.otherMembers.map((m) => m.user.firstName).join(", ")

							return (
								<CommandMenuItem
									key={`recent-${channel.id}`}
									textValue={displayName}
									onAction={() => {
										navigate({
											to: "/$orgSlug/chat/$id",
											params: { orgSlug: orgSlug!, id: channel.id },
										})
										onClose()
									}}
								>
									{dmData.type === "single" &&
									dmData.otherMembers.length === 1 &&
									firstMember ? (
										<Avatar
											size="xs"
											className="mr-1"
											data-slot="icon"
											src={firstMember.user.avatarUrl}
											alt={displayName}
										/>
									) : (
										<div data-slot="icon" className="flex -space-x-2 mr-1">
											{dmData.otherMembers.slice(0, 2).map((member) => (
												<Avatar
													key={member.userId}
													size="xs"
													src={member.user.avatarUrl}
													alt={member.user.firstName}
													className="ring-[1.5px] ring-overlay"
												/>
											))}
											{dmData.otherMembers.length > 2 && (
												<Avatar
													size="xs"
													className="ring-[1.5px] ring-overlay"
													placeholder={
														<span className="flex items-center justify-center font-semibold text-quaternary text-xs">
															+{dmData.otherMembers.length - 2}
														</span>
													}
												/>
											)}
										</div>
									)}
									<CommandMenuLabel>{displayName}</CommandMenuLabel>
								</CommandMenuItem>
							)
						}

						return (
							<CommandMenuItem
								key={`recent-${channel.id}`}
								textValue={channel.name}
								onAction={() => {
									navigate({
										to: "/$orgSlug/chat/$id",
										params: { orgSlug: orgSlug!, id: channel.id },
									})
									onClose()
								}}
							>
								<ChannelIcon icon={channel.icon} />
								<CommandMenuLabel>{channel.name}</CommandMenuLabel>
							</CommandMenuItem>
						)
					})}
				</CommandMenuSection>
			)}

			{/* Quick Actions */}
			<CommandMenuSection label="Quick Actions">
				<CommandMenuItem onAction={() => navigateToPage("search")} textValue="search messages find">
					<IconMagnifier />
					<CommandMenuLabel>Search messages</CommandMenuLabel>
					<CommandMenuShortcut>{searchHotkeyLabel}</CommandMenuShortcut>
				</CommandMenuItem>
				<CommandMenuItem onAction={() => navigateToPage("create-channel")} textValue="create channel">
					<IconPlus />
					<CommandMenuLabel>Create channel</CommandMenuLabel>
					<CommandMenuShortcut>{createChannelHotkeyLabel}</CommandMenuShortcut>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						createDmModal.open()
						onClose()
					}}
					textValue="start conversation new dm"
				>
					<IconMsgs />
					<CommandMenuLabel>Start conversation</CommandMenuLabel>
					<CommandMenuShortcut>{createDmHotkeyLabel}</CommandMenuShortcut>
				</CommandMenuItem>
				<CommandMenuItem onAction={() => navigateToPage("join-channel")} textValue="join channel">
					<IconPlus />
					<CommandMenuLabel>Join channel</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						emailInviteModal.open()
						onClose()
					}}
					textValue="invite members"
				>
					<IconUsersPlus />
					<CommandMenuLabel>Invite members</CommandMenuLabel>
					<CommandMenuShortcut>{inviteHotkeyLabel}</CommandMenuShortcut>
				</CommandMenuItem>
			</CommandMenuSection>

			{/* All Channels (for search) */}
			{allChannels && allChannels.length > 0 && (
				<CommandMenuSection label="Channels">
					{allChannels.map(({ channel }) => (
						<CommandMenuItem
							key={`channel-${channel.id}`}
							textValue={channel.name}
							onAction={() => {
								trackChannel(channel.id)
								navigate({
									to: "/$orgSlug/chat/$id",
									params: { orgSlug: orgSlug!, id: channel.id },
								})
								onClose()
							}}
						>
							<ChannelIcon icon={channel.icon} />
							<CommandMenuLabel>{channel.name}</CommandMenuLabel>
						</CommandMenuItem>
					))}
				</CommandMenuSection>
			)}

			{/* Direct Messages (for search) */}
			{dmChannels.length > 0 && (
				<CommandMenuSection label="Direct Messages">
					{dmChannels.map((dm) => {
						const firstMember = dm.otherMembers[0]
						// Build display name and search text from other members
						const displayName =
							dm.type === "single" && dm.otherMembers.length === 1 && firstMember
								? `${firstMember.user.firstName} ${firstMember.user.lastName}`
								: dm.otherMembers.map((m) => m.user.firstName).join(", ")

						// Include full names in textValue for better search
						const searchText = dm.otherMembers
							.map((m) => `${m.user.firstName} ${m.user.lastName}`)
							.join(" ")

						return (
							<CommandMenuItem
								key={`dm-${dm.id}`}
								textValue={searchText}
								onAction={() => {
									trackChannel(dm.id)
									navigate({
										to: "/$orgSlug/chat/$id",
										params: { orgSlug: orgSlug!, id: dm.id },
									})
									onClose()
								}}
							>
								{dm.type === "single" && dm.otherMembers.length === 1 && firstMember ? (
									<Avatar
										size="xs"
										className="mr-1"
										data-slot="icon"
										src={firstMember.user.avatarUrl}
										alt={displayName}
									/>
								) : (
									<div data-slot="icon" className="flex -space-x-2 mr-1">
										{dm.otherMembers.slice(0, 2).map((member) => (
											<Avatar
												key={member.userId}
												size="xs"
												src={member.user.avatarUrl}
												alt={member.user.firstName}
												className="ring-[1.5px] ring-overlay"
											/>
										))}
										{dm.otherMembers.length > 2 && (
											<Avatar
												size="xs"
												className="ring-[1.5px] ring-overlay"
												placeholder={
													<span className="flex items-center justify-center font-semibold text-quaternary text-xs">
														+{dm.otherMembers.length - 2}
													</span>
												}
											/>
										)}
									</div>
								)}
								<CommandMenuLabel>{displayName}</CommandMenuLabel>
							</CommandMenuItem>
						)
					})}
				</CommandMenuSection>
			)}

			{/* Navigation */}
			<CommandMenuSection label="Navigation">
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="dashboard home"
				>
					<IconDashboard />
					<CommandMenuLabel>Dashboard</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/chat", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="chat messages"
				>
					<IconMsgs />
					<CommandMenuLabel>Chat</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/notifications", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="notifications"
				>
					<IconBell />
					<CommandMenuLabel>Notifications</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/my-settings", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="my settings preferences"
				>
					<IconGear />
					<CommandMenuLabel>My Settings</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/my-settings/profile", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="my profile"
				>
					<IconCircleDottedUser />
					<CommandMenuLabel>My Profile</CommandMenuLabel>
				</CommandMenuItem>
			</CommandMenuSection>

			{/* Settings */}
			<CommandMenuSection label="Settings">
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/settings", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="general settings"
				>
					<IconGear />
					<CommandMenuLabel>General Settings</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/settings/team", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="team members"
				>
					<IconDashboard />
					<CommandMenuLabel>Team</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/settings/integrations", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="integrations"
				>
					<IconIntegration />
					<CommandMenuLabel>Integrations</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/settings/invitations", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="invitations"
				>
					<IconUsersPlus />
					<CommandMenuLabel>Invitations</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => {
						navigate({ to: "/$orgSlug/settings/debug", params: { orgSlug: orgSlug! } })
						onClose()
					}}
					textValue="debug"
				>
					<IconServers />
					<CommandMenuLabel>Debug</CommandMenuLabel>
				</CommandMenuItem>
			</CommandMenuSection>

			{/* Preferences */}
			<CommandMenuSection label="Preferences">
				<CommandMenuItem onAction={() => navigateToPage("status")} textValue="set status presence">
					<IconCircleDottedUser />
					<CommandMenuLabel>Set status...</CommandMenuLabel>
				</CommandMenuItem>
				<CommandMenuItem
					onAction={() => navigateToPage("appearance")}
					textValue="appearance theme dark light mode"
				>
					<IconGear />
					<CommandMenuLabel>Change appearance...</CommandMenuLabel>
				</CommandMenuItem>
			</CommandMenuSection>
		</>
	)
}
