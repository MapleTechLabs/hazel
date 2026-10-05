import type { OrganizationId } from "@hazel/schema"
import { and, eq, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { SidebarSection } from "~/components/ui/sidebar"
import { Strong } from "~/components/ui/text"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"
import { ChannelItem, type SidebarChannelData, type SidebarChannelMemberData } from "./channel-item"
import { DmChannelItem } from "./dm-channel-item"

export const FavoriteSection = (props: {
	organizationId: OrganizationId
	unreadByChannel: Map<string, number>
}) => {
	const { user } = useAuth()

	const { data: favoriteChannels } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.innerJoin({ member: channelMemberCollection }, ({ channel, member }) =>
					eq(member.channelId, channel.id),
				)
				.where((q) =>
					and(
						eq(q.channel.organizationId, props.organizationId),
						eq(q.member.userId, user?.id || ""),
						eq(q.member.isFavorite, true),
						eq(q.member.isHidden, false),
					),
				)
				.orderBy(({ channel }) => channel.createdAt, "asc"),
		queryKey: [user?.id, props.organizationId],
	})

	const { publicPrivateChannels, dmChannels } = useMemo(() => {
		if (!favoriteChannels) return { publicPrivateChannels: [], dmChannels: [] }

		const publicPrivate: Array<{
			channel: (typeof favoriteChannels)[0]["channel"]
			member: (typeof favoriteChannels)[0]["member"]
		}> = []
		const dm: Array<(typeof favoriteChannels)[0]["channel"]> = []

		favoriteChannels.forEach((row) => {
			if (row.channel.type === "public" || row.channel.type === "private") {
				publicPrivate.push({ channel: row.channel, member: row.member })
			} else if (row.channel.type === "direct" || row.channel.type === "single") {
				dm.push(row.channel)
			}
		})

		return { publicPrivateChannels: publicPrivate, dmChannels: dm }
	}, [favoriteChannels])

	if (!favoriteChannels || favoriteChannels.length === 0) {
		return null
	}

	return (
		<SidebarSection
			tree={{ "aria-label": "Favorite channels" }}
			header={
				<div className="col-span-full flex items-center justify-between gap-x-2 pl-2.5 text-muted-fg text-xs/5">
					<Strong>Favorites</Strong>
				</div>
			}
		>
			{publicPrivateChannels.map(({ channel, member }) => (
				<ChannelItem
					key={channel.id}
					channel={channel as unknown as SidebarChannelData}
					member={member as unknown as SidebarChannelMemberData}
					notificationCount={props.unreadByChannel.get(channel.id) ?? member.notificationCount}
				/>
			))}
			{dmChannels.map((channel) => (
				<DmChannelItem
					key={channel.id}
					channelId={channel.id}
					notificationCount={props.unreadByChannel.get(channel.id) ?? 0}
				/>
			))}
		</SidebarSection>
	)
}
