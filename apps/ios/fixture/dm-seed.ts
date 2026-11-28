/**
 * Four more DMs for the DMs screen (`fixture-backend.ts --dms`, the demo build): Katherine (unread),
 * Alan (Ada wrote last), a group with Margaret and Dennis, and Dennis with no message yet. Times are
 * relative to now, so rows read `2h`, `Yesterday`, `Mon`. Written before any client connects, so
 * they are part of the snapshot.
 */
import type { FixtureServer } from "./fixture-socket"
import { adaUserId, channelMemberRows, channelRows, orgId, userRows } from "./snapshot"

type ChannelRow = (typeof channelRows)[number]
type MemberRow = (typeof channelMemberRows)[number]

/** Writes the DMs into `server`; returns their channel and membership rows. */
export const seedDms = (
	server: FixtureServer,
): { readonly channels: ReadonlyArray<ChannelRow>; readonly members: ReadonlyArray<MemberRow> } => {
	const channels: Array<ChannelRow> = []
	const members: Array<MemberRow> = []

	const userNamed = (firstName: string) =>
		userRows.find((row) => row.firstName === firstName)?.id ?? adaUserId
	const uuid = (group: number, index: number) =>
		`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
	const now = Date.now()
	const base = channelRows[0]
	const memberBase = channelMemberRows[0]
	if (base === undefined || memberBase === undefined) return { channels, members }
	const seeds = [
		{
			n: 10,
			type: "single",
			with: ["Katherine"],
			at: 2 * 3_600_000,
			from: "Katherine",
			text: "Deck is ready for review 🚀",
			unread: 1,
		},
		{
			n: 11,
			type: "single",
			with: ["Alan"],
			at: 26 * 3_600_000,
			from: "Ada",
			text: "Pushed the fix, can you take a look when you have a minute?",
			unread: 0,
		},
		{
			n: 12,
			type: "direct",
			with: ["Margaret", "Dennis"],
			at: 4 * 86_400_000,
			from: "Margaret",
			text: "Lunch on Friday?",
			unread: 0,
		},
		{ n: 13, type: "single", with: ["Dennis"], at: null, from: null, text: null, unread: 0 },
	] as const
	for (const seed of seeds) {
		const id = uuid(5, seed.n) as (typeof base)["id"]
		const row = {
			...base,
			id,
			name: "",
			type: seed.type,
			sectionId: null,
			lastMessageAt: seed.at === null ? null : new Date(now - seed.at).toISOString(),
			lastMessageAuthorId: seed.from === null ? null : userNamed(seed.from),
			lastMessagePreview: seed.text,
		}
		channels.push(row)
		server.write("org", orgId, "channels", [row])
		const rows = [adaUserId, ...seed.with.map(userNamed)].map((userId, index) => ({
			...memberBase,
			id: uuid(7, seed.n * 16 + index + 1),
			channelId: id,
			userId,
			isFavorite: false,
			notificationCount: userId === adaUserId ? seed.unread : 0,
		}))
		members.push(...rows)
		server.write("org", orgId, "channel_members", rows)
	}
	return { channels, members }
}
