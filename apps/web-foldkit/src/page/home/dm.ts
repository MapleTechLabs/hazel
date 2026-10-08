import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { eq, type InitialQueryBuilder, or } from "@tanstack/db"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import type { DmRow } from "./model"

/** `lib/channels.ts`'s DM query, run by the page's `dmChannels` subscription. */
export const dmChannelsQuery = (q: InitialQueryBuilder) =>
	q
		.from({ channel: channelCollection })
		.innerJoin({ member: channelMemberCollection }, ({ channel, member }) => eq(member.channelId, channel.id))
		.where(({ channel }) => or(eq(channel.type, "single"), eq(channel.type, "direct")))

/** `findExistingDmChannel`: a single DM with exactly the two users, or a group DM with exactly them all. */
export const findExistingDmChannel = (
	rows: ReadonlyArray<DmRow>,
	currentUserId: UserId,
	targetUserIds: ReadonlyArray<UserId>,
	organizationId: OrganizationId,
): ChannelId | null => {
	if (rows.length === 0 || targetUserIds.length === 0) return null
	const allParticipants = [currentUserId, ...targetUserIds].sort()
	const byChannel = new Map<string, { type: string; id: ChannelId; memberIds: Array<string> }>()
	for (const row of rows) {
		if (row.channel.organizationId !== organizationId) continue
		const entry = byChannel.get(row.channel.id) ?? {
			type: row.channel.type,
			id: row.channel.id,
			memberIds: [],
		}
		entry.memberIds.push(row.member.userId)
		byChannel.set(row.channel.id, entry)
	}
	for (const { type, id, memberIds } of byChannel.values()) {
		const target = targetUserIds[0]
		if (type === "single" && targetUserIds.length === 1 && target) {
			if (memberIds.length === 2 && memberIds.includes(currentUserId) && memberIds.includes(target)) {
				return id
			}
		}
		if (type === "direct" && targetUserIds.length > 1) {
			const sorted = [...memberIds].sort()
			if (
				sorted.length === allParticipants.length &&
				sorted.every((memberId, index) => memberId === allParticipants[index])
			) {
				return id
			}
		}
	}
	return null
}
