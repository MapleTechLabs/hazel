/** The fixture org's sidebar, as the web groups it: sections in order, then direct messages. */
import type { Section } from "../../../packages/ui/src/demo/ChannelList.ts"
import { adaUserId, channelMemberRows, channelRows, channelSectionRows, userRows } from "../fixture/snapshot"

export const sections = (): ReadonlyArray<Section> => {
	const unread = new Map(
		channelMemberRows
			.filter((row) => row.userId === adaUserId)
			.map((row) => [row.channelId, row.notificationCount]),
	)
	const grouped = [...channelSectionRows]
		.sort((a, b) => a.order - b.order)
		.map((section) => ({
			title: section.name,
			channels: channelRows
				.filter((channel) => channel.sectionId === section.id)
				.map((channel) => ({
					id: channel.id,
					title: channel.name,
					symbol: channel.type === "private" ? "lock" : "number",
					unread: unread.get(channel.id) ?? 0,
				})),
		}))
	const people = channelRows
		.filter((channel) => channel.type === "single")
		.map((channel) => {
			const partner = channelMemberRows.find(
				(row) => row.channelId === channel.id && row.userId !== adaUserId,
			)
			const user = userRows.find((row) => row.id === partner?.userId)
			const title = user === undefined ? "Direct message" : `${user.firstName} ${user.lastName}`
			const initials = title
				.split(/\s+/)
				.map((part) => part[0] ?? "")
				.join("")
				.slice(0, 2)
			return { id: channel.id, title, initials, unread: unread.get(channel.id) ?? 0 }
		})
	return [...grouped, { title: "Direct messages", channels: people }]
}
