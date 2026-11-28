/**
 * The sidebar from live rows, grouped as the web groups it: sections in order (unsectioned
 * channels under "Channels"), then direct messages named after the other member.
 */
import type { Channel, ChannelMember, ChannelSection, User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import type { Section } from "../../../packages/ui/src/demo/ChannelList.ts"

export interface SidebarRows {
	readonly channels: ReadonlyArray<typeof Channel.Schema.Type>
	readonly sections: ReadonlyArray<typeof ChannelSection.Schema.Type>
	readonly members: ReadonlyArray<typeof ChannelMember.Schema.Type>
	readonly users: ReadonlyArray<typeof User.Schema.Type>
}

const initialsOf = (title: string) =>
	title
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)

export const sidebarSections = (me: UserId, rows: SidebarRows): ReadonlyArray<Section> => {
	const mine = new Map(
		rows.members
			.filter((row) => row.userId === me && !row.isHidden && row.deletedAt === null)
			.map((row) => [row.channelId as string, row]),
	)
	const visible = rows.channels.filter(
		(channel) => channel.deletedAt === null && channel.parentChannelId === null && mine.has(channel.id),
	)
	const unread = (id: string) => mine.get(id)?.notificationCount ?? 0
	const row = (channel: (typeof visible)[number]) => ({
		id: channel.id,
		title: channel.name,
		symbol: channel.type === "private" ? "lock" : "number",
		unread: unread(channel.id),
	})
	const isRoom = (channel: (typeof visible)[number]) =>
		channel.type === "public" || channel.type === "private"
	const byName = (a: { readonly name: string }, b: { readonly name: string }) =>
		a.name.localeCompare(b.name)

	const grouped: Array<Section> = [...rows.sections]
		.filter((section) => section.deletedAt === null)
		.sort((a, b) => a.order - b.order)
		.map((section) => ({
			title: section.name,
			channels: visible
				.filter((channel) => isRoom(channel) && channel.sectionId === section.id)
				.sort(byName)
				.map(row),
		}))
	const sectionIds = new Set(rows.sections.map((section) => section.id as string))
	const loose = visible.filter(
		(channel) => isRoom(channel) && (channel.sectionId === null || !sectionIds.has(channel.sectionId)),
	)
	if (loose.length > 0) grouped.unshift({ title: "Channels", channels: loose.sort(byName).map(row) })

	const people = visible
		.filter((channel) => channel.type === "single" || channel.type === "direct")
		.map((channel) => {
			const partner = rows.members.find(
				(member) => member.channelId === channel.id && member.userId !== me,
			)
			const user = rows.users.find((candidate) => candidate.id === partner?.userId)
			const title = user === undefined ? channel.name : `${user.firstName} ${user.lastName}`.trim()
			return { id: channel.id, title, initials: initialsOf(title), unread: unread(channel.id) }
		})
	return [
		...grouped.filter((section) => section.channels.length > 0),
		{ title: "Direct messages", channels: people },
	]
}
