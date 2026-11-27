import type { PageFixture } from "../page-fixture"
import { channelIds, orgId, userRows } from "../snapshot"

const NOW = Date.parse("2026-11-26T15:00:00Z")
const MINUTE = 60 * 1000

/** Someone else's newest message in four of Ada's channels (by index in the fixture's channels), minutes ago. */
const unread = [
	{ channel: 4, minutesAgo: 5 }, // #design, 3 mentions
	{ channel: 8, minutesAgo: 42 }, // the DM with Grace, 2
	{ channel: 6, minutesAgo: 180 }, // #releases, 1
	{ channel: 7, minutesAgo: 60 * 26 }, // #random, no mention
]

/** `/hazel/notifications/unreads`: `channel_activity` rows that leave those channels unread for Ada. */
const fixture: PageFixture = {
	seed: (server) =>
		server.write(
			"org",
			orgId,
			"channel_activity",
			unread.map(({ channel, minutesAgo }, index) => ({
				// The fixture keeps a write's rows by `id`; the collection keys them by `channelId`.
				id: channelIds[channel],
				channelId: channelIds[channel],
				organizationId: orgId,
				lastMessageId: `0000000e-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
				lastMessageAt: new Date(NOW - minutesAgo * MINUTE).toISOString(),
				lastMessageAuthorId: userRows[1]?.id,
			})),
		),
}

export default fixture
