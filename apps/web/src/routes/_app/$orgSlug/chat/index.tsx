import { eq, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute, Link, useParams } from "@tanstack/react-router"
import { useMemo } from "react"
import { useModal } from "~/atoms/modal-atoms"
import IconHashtag from "~/components/icons/icon-hashtag"
import IconLock from "~/components/icons/icon-lock"
import IconMsgs from "~/components/icons/icon-msgs"
import IconPlus from "~/components/icons/icon-plus"
import { IconUsers } from "~/components/icons/icon-users"
import IconVolumeMute from "~/components/icons/icon-volume-mute"
import { Avatar } from "~/components/ui/avatar"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import { Loader } from "~/components/ui/loader"
import { SectionHeader } from "~/components/ui/section-header"
import { Tab, TabList, TabPanel, Tabs } from "~/components/ui/tabs"
import { channelCollection, channelMemberCollection, userCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { usePermission } from "~/hooks/use-permission"
import { useUserPresence } from "~/hooks/use-presence"
import { useAuth } from "~/lib/auth"
import { cn } from "~/lib/utils"

export const Route = createFileRoute("/_app/$orgSlug/chat/")({
	component: RouteComponent,
})

function RouteComponent() {
	const { organizationId } = useOrganization()
	const { user: me } = useAuth()
	const { can } = usePermission()
	const newChannelModal = useModal("new-channel")
	const createDmModal = useModal("create-dm")

	// Get all channels with members and users in a single query
	const { data: channelsData, isLoading: channelsLoading } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
					eq(member.channelId, channel.id),
				)
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(user.id, member.userId))
				.where((q) => eq(q.channel.organizationId, organizationId))
				.orderBy(({ channel }) => channel.createdAt, "asc"),
		queryKey: [organizationId],
	})

	const { publicChannels, privateChannels, dmChannels } = useMemo(() => {
		if (!channelsData || !me?.id) {
			return { publicChannels: [], privateChannels: [], dmChannels: [] }
		}

		// Group all data by channel
		const channelMap = new Map<string, { channel: any; members: any[]; myMember?: any }>()

		for (const row of channelsData) {
			if (!channelMap.has(row.channel.id)) {
				channelMap.set(row.channel.id, { channel: row.channel, members: [] })
			}
			const data = channelMap.get(row.channel.id)!
			data.members.push({ ...row.member, user: row.user })
			if (row.member.userId === me.id) {
				data.myMember = row.member
			}
		}

		// Filter to only channels where user is a member and not hidden, then split by type
		const public_: any[] = []
		const private_: any[] = []
		const dms: any[] = []

		for (const { channel, members, myMember } of channelMap.values()) {
			if (!myMember || myMember.isHidden) continue

			const baseData = {
				_id: channel.id,
				name: channel.name,
				type: channel.type,
				isMuted: myMember.isMuted,
				currentUser: { notificationCount: myMember.notificationCount || 0 },
				memberCount: members.length,
			}

			if (channel.type === "public") {
				public_.push({ ...baseData, isFavorite: myMember.isFavorite })
			} else if (channel.type === "private") {
				private_.push({ ...baseData, isFavorite: myMember.isFavorite })
			} else if (channel.type === "direct" || channel.type === "single") {
				dms.push({ ...baseData, members })
			}
		}

		return { publicChannels: public_, privateChannels: private_, dmChannels: dms }
	}, [channelsData, me])

	if (channelsLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Loader className="size-8" />
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-6 px-4 py-6 lg:px-8">
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="space-y-0.5">
						<SectionHeader.Heading size="xl">All channels</SectionHeader.Heading>
						<SectionHeader.Subheading>
							Discover communities and join the discussions that matter to you.
						</SectionHeader.Subheading>
					</div>
				</SectionHeader.Group>
			</SectionHeader.Root>

			<Tabs defaultSelectedKey="public">
				<TabList className="w-full">
					<Tab id="public">
						<span className="flex items-center gap-2">
							Public
							{publicChannels.length > 0 && (
								<Badge intent="secondary">{publicChannels.length}</Badge>
							)}
						</span>
					</Tab>
					<Tab id="private">
						<span className="flex items-center gap-2">
							Private
							{privateChannels.length > 0 && (
								<Badge intent="secondary">{privateChannels.length}</Badge>
							)}
						</span>
					</Tab>
					<Tab id="dms">
						<span className="flex items-center gap-2">
							Direct messages
							{dmChannels.length > 0 && <Badge intent="secondary">{dmChannels.length}</Badge>}
						</span>
					</Tab>
				</TabList>

				<TabPanel id="public">
					{publicChannels.length > 0 ? (
						<Card>
							<h2 className="sr-only">Public Channels</h2>
							<div className="divide-y divide-border">
								{publicChannels.map((channel) => (
									<ChannelCard key={channel._id} channel={channel} />
								))}
							</div>
						</Card>
					) : (
						<EmptyState
							icon={IconHashtag}
							title="No public channels"
							description="Public channels are open for everyone in the organization to join."
							action={
								can("channel.create") ? (
									<Button
										intent="secondary"
										size="sm"
										onPress={() => newChannelModal.open()}
									>
										<IconPlus data-slot="icon" />
										Create a channel
									</Button>
								) : undefined
							}
						/>
					)}
				</TabPanel>

				<TabPanel id="private">
					{privateChannels.length > 0 ? (
						<Card>
							<h2 className="sr-only">Private Channels</h2>
							<div className="divide-y divide-border">
								{privateChannels.map((channel) => (
									<ChannelCard key={channel._id} channel={channel} isPrivate />
								))}
							</div>
						</Card>
					) : (
						<EmptyState
							icon={IconLock}
							title="No private channels"
							description="Private channels are invite-only spaces for focused discussions."
							action={
								can("channel.create") ? (
									<Button
										intent="secondary"
										size="sm"
										onPress={() => newChannelModal.open()}
									>
										<IconPlus data-slot="icon" />
										Create a private channel
									</Button>
								) : undefined
							}
						/>
					)}
				</TabPanel>

				<TabPanel id="dms">
					{dmChannels.length > 0 ? (
						<Card>
							<h2 className="sr-only">Direct Messages</h2>
							<div className="divide-y divide-border">
								{dmChannels.map((channel) => (
									<DmCard key={channel._id} channel={channel} currentUserId={me?.id} />
								))}
							</div>
						</Card>
					) : (
						<EmptyState
							icon={IconMsgs}
							title="No direct messages"
							description="Start a conversation with someone in your organization."
							action={
								<Button intent="secondary" size="sm" onPress={() => createDmModal.open()}>
									<IconPlus data-slot="icon" />
									Start a conversation
								</Button>
							}
						/>
					)}
				</TabPanel>
			</Tabs>
		</div>
	)
}

function NotificationBadge({ count }: { count: number }) {
	if (count <= 0) return null
	return (
		<Badge intent="danger" className="min-w-5 justify-center">
			{count > 99 ? "99+" : count}
		</Badge>
	)
}

function ChannelCard({ channel, isPrivate = false }: { channel: any; isPrivate?: boolean }) {
	const { orgSlug } = useParams({ from: "/_app/$orgSlug" })

	return (
		<Link
			to="/$orgSlug/chat/$id"
			params={{ orgSlug, id: channel._id }}
			className="group flex items-center justify-between gap-4 px-4 py-3 transition-all duration-200 hover:bg-secondary/50"
		>
			<div className="flex min-w-0 items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
					{isPrivate ? (
						<IconLock className="size-5 text-muted-fg" />
					) : (
						<IconHashtag className="size-5 text-muted-fg" />
					)}
				</div>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h3
							className={cn(
								"truncate font-semibold text-fg text-sm",
								channel.isMuted && "text-muted-fg",
							)}
						>
							{channel.name}
						</h3>
						{channel.isFavorite && <span className="shrink-0 text-favorite">★</span>}
					</div>
					<div className="mt-0.5 flex items-center gap-3 text-muted-fg text-xs">
						<span className="flex items-center gap-1">
							<IconUsers className="size-3.5" />
							{channel.memberCount || 0}
						</span>
						{channel.isMuted && (
							<span className="flex items-center gap-1">
								<IconVolumeMute className="size-3.5" />
								Muted
							</span>
						)}
					</div>
				</div>
			</div>
			<NotificationBadge count={channel.currentUser?.notificationCount || 0} />
		</Link>
	)
}

function DmCard({ channel, currentUserId }: { channel: any; currentUserId?: string }) {
	const { orgSlug } = useParams({ from: "/_app/$orgSlug" })
	const otherMembers = channel.members.filter((member: any) => member.userId !== currentUserId)

	if (channel.type === "single" && otherMembers.length === 1) {
		return <SingleDmCard channel={channel} member={otherMembers[0]} orgSlug={orgSlug} />
	}

	return (
		<Link
			to="/$orgSlug/chat/$id"
			params={{ orgSlug, id: channel._id }}
			className="group flex items-center justify-between gap-4 px-4 py-3 transition-all duration-200 hover:bg-secondary/50"
		>
			<div className="flex min-w-0 items-center gap-3">
				<div className="flex shrink-0 -space-x-3">
					{otherMembers.slice(0, 3).map((member: any) => (
						<Avatar
							key={member.user.id}
							size="sm"
							src={member.user.avatarUrl}
							alt={member.user.firstName}
							className="ring-2 ring-bg"
						/>
					))}
				</div>
				<div className="min-w-0">
					<h3
						className={cn(
							"truncate font-semibold text-fg text-sm",
							channel.isMuted && "text-muted-fg",
						)}
					>
						{otherMembers
							.slice(0, 3)
							.map((member: any) => member.user.firstName)
							.join(", ")}
						{otherMembers.length > 3 && (
							<span className="text-muted-fg"> +{otherMembers.length - 3}</span>
						)}
					</h3>
					<p className="text-muted-fg text-xs">{otherMembers.length} participants</p>
				</div>
			</div>
			<NotificationBadge count={channel.currentUser?.notificationCount || 0} />
		</Link>
	)
}

function SingleDmCard({ channel, member, orgSlug }: { channel: any; member: any; orgSlug: string }) {
	const { isOnline, status } = useUserPresence(member.user.id)

	const statusText = isOnline
		? "Active now"
		: status === "away"
			? "Away"
			: status === "busy"
				? "Busy"
				: status === "dnd"
					? "Do not disturb"
					: "Offline"

	return (
		<Link
			to="/$orgSlug/chat/$id"
			params={{ orgSlug, id: channel._id }}
			className="group flex items-center justify-between gap-4 px-4 py-3 transition-all duration-200 hover:bg-secondary/50"
		>
			<div className="flex min-w-0 items-center gap-3">
				<div className="relative shrink-0">
					<Avatar
						size="md"
						src={member.user.avatarUrl}
						alt={`${member.user.firstName} ${member.user.lastName}`}
					/>
					<span
						className={cn(
							"absolute right-0 bottom-0 size-3 rounded-full border-2 border-bg",
							isOnline ? "bg-success" : "bg-muted",
						)}
					/>
				</div>
				<div className="min-w-0">
					<h3
						className={cn(
							"truncate font-semibold text-fg text-sm",
							channel.isMuted && "text-muted-fg",
						)}
					>
						{member.user.firstName} {member.user.lastName}
					</h3>
					<p className="text-muted-fg text-xs">{statusText}</p>
				</div>
			</div>
			<NotificationBadge count={channel.currentUser?.notificationCount || 0} />
		</Link>
	)
}
