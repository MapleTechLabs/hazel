/**
 * A thread on #general's last message, with a few replies (the offline fixture has none): the web
 * offline build seeds it, and the fixture backend with `--thread`.
 */
import type { makeFixtureServer } from "./fixture-socket"
import * as fixture from "./snapshot"

export const GENERAL_THREAD_ID = "00000000-0000-4000-8000-0000000e0001"

/** `snapshotFor`, with the thread's own source served as an empty channel's tables. */
export const snapshotWithThread: typeof fixture.snapshotFor = (kind, sourceId) =>
	fixture.snapshotFor(
		kind,
		kind === "channel" && sourceId === GENERAL_THREAD_ID ? (fixture.channelRows[1]?.id ?? "") : sourceId,
	)

export const seedGeneralThread = (server: ReturnType<typeof makeFixtureServer>) => {
	const threadId = GENERAL_THREAD_ID
	const parent = fixture.generalMessageRows.at(-1)
	const [template] = fixture.channelRows
	const [membership] = fixture.channelMemberRows
	if (parent !== undefined && template !== undefined && membership !== undefined) {
		server.write("org", fixture.orgId, "channels", [
			{
				...template,
				id: threadId,
				name: "Benchmarks",
				type: "thread",
				parentChannelId: parent.channelId,
				sectionId: null,
			},
		])
		server.write("org", fixture.orgId, "channel_members", [
			{
				...membership,
				id: "00000000-0000-4000-8000-0000000e0002",
				channelId: threadId,
				notificationCount: 0,
			},
		])
		server.write("channel", parent.channelId, "messages", [{ ...parent, threadChannelId: threadId }])
		const replies = [
			"Which build should I use?",
			"The release one from this morning.",
			"Numbers in an hour.",
		]
		server.write(
			"channel",
			threadId,
			"messages",
			replies.map((content, index) => ({
				...parent,
				id: `00000000-0000-4000-8000-0000000e01${String(index).padStart(2, "0")}`,
				channelId: threadId,
				authorId:
					(fixture.userRows[index % fixture.userRows.length] ?? fixture.userRows[0])?.id ??
					parent.authorId,
				content,
				threadChannelId: null,
				createdAt: new Date(
					new Date(parent.createdAt).getTime() + (index + 1) * 60_000,
				).toISOString(),
			})),
		)
	}
}
