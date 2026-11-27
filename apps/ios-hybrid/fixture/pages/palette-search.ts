import type { PageFixture } from "../page-fixture"
import { channelIds, userRows } from "../snapshot"

/**
 * The command palette's message search: `message.search` answers every query with two hits (Grace in
 * #engineering, Alan in #general), as the org's index would. The other palette pages reuse it.
 */
const [grace, alan] = [userRows[1], userRows[2]]
const [general, engineering] = [channelIds[0], channelIds[1]]

const hit = (
	n: number,
	authorId: string | undefined,
	channelId: string | undefined,
	snippet: string,
	at: string,
) => ({
	messageId: `00000020-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
	channelId,
	authorId,
	createdAt: at,
	snippet,
	highlights: [],
})

const fixture: PageFixture = {
	rpcs: {
		"message.search": () => ({
			results: [
				hit(
					1,
					grace?.id,
					engineering,
					"The release notes for 4.2 are ready for review",
					"2026-11-26T13:00:00.000Z",
				),
				hit(
					2,
					alan?.id,
					general,
					"Shipping the release candidate after lunch",
					"2026-11-25T10:30:00.000Z",
				),
			],
			nextCursor: null,
			indexing: false,
		}),
	},
}

export default fixture
