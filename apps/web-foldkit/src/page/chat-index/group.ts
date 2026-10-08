import type { ChannelId, UserId } from "@hazel/schema"
import type { ChannelGroups, ChannelSummary, DmParticipant } from "./model"

/** The legacy `useMemo`: group the joined rows by channel, keep the user's visible channels, split by type. */

export interface ChannelRow {
	readonly channel: { readonly id: ChannelId; readonly name: string; readonly type: string }
	readonly member: {
		readonly userId: UserId
		readonly isHidden: boolean
		readonly isMuted: boolean
		readonly isFavorite: boolean
		readonly notificationCount?: number | null
	}
	readonly user: {
		readonly id: UserId
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	}
}

export const groupChannels = (
	rows: ReadonlyArray<ChannelRow>,
	currentUserId: UserId | null,
): ChannelGroups => {
	const empty: ChannelGroups = { publicChannels: [], privateChannels: [], dmChannels: [] }
	if (currentUserId === null) return empty
	const byChannel = new Map<
		string,
		{ channel: ChannelRow["channel"]; members: Array<DmParticipant>; mine?: ChannelRow["member"] }
	>()
	for (const row of rows) {
		const entry = byChannel.get(row.channel.id) ?? { channel: row.channel, members: [] }
		entry.members.push({
			userId: row.user.id,
			firstName: row.user.firstName,
			lastName: row.user.lastName,
			avatarUrl: row.user.avatarUrl ?? null,
		})
		if (row.member.userId === currentUserId) entry.mine = row.member
		byChannel.set(row.channel.id, entry)
	}
	const publicChannels: Array<ChannelSummary> = []
	const privateChannels: Array<ChannelSummary> = []
	const dmChannels: Array<ChannelSummary> = []
	for (const { channel, members, mine } of byChannel.values()) {
		if (!mine || mine.isHidden) continue
		const summary: ChannelSummary = {
			id: channel.id,
			name: channel.name,
			type: channel.type,
			isMuted: mine.isMuted,
			isFavorite: mine.isFavorite,
			notificationCount: mine.notificationCount || 0,
			memberCount: members.length,
			members,
		}
		if (channel.type === "public") publicChannels.push(summary)
		else if (channel.type === "private") privateChannels.push(summary)
		else if (channel.type === "direct" || channel.type === "single") dmChannels.push(summary)
	}
	return { publicChannels, privateChannels, dmChannels }
}
