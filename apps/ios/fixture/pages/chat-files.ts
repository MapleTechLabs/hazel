import type { FixtureServer } from "../fixture-socket"
import type { PageFixture } from "../page-fixture"
import { adaUserId, generalChannelId, orgId, userRows } from "../snapshot"

/** A flat picture as a data URL, so the offline build draws media with no network. */
const picture = (fill: string, width: number, height: number) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`,
	)}`

const uploader = (index: number) => userRows[index % userRows.length]?.id ?? adaUserId

/** Three images and three documents in #general, newest first, over the last two weeks. */
const files = [
	{ name: "launch-banner.png", size: 482_133, url: picture("#7c5cfc", 1200, 800), daysAgo: 0 },
	{ name: "roadmap-q1.pdf", size: 1_204_000, url: null, daysAgo: 1 },
	{ name: "whiteboard.jpg", size: 220_400, url: picture("#38bdf8", 800, 1000), daysAgo: 3 },
	{ name: "metrics.csv", size: 18_230, url: null, daysAgo: 9 },
	{ name: "team-offsite.webp", size: 96_000, url: picture("#f59e0b", 1000, 700), daysAgo: 12 },
	{ name: "notes.txt", size: 2_048, url: null, daysAgo: 13 },
]

const NOW = Date.parse("2026-11-26T15:00:00Z")
const DAY = 24 * 60 * 60 * 1000

export const seedChannelFiles = (server: FixtureServer) =>
	server.write(
		"channel",
		generalChannelId,
		"attachments",
		files.map((file, index) => ({
			id: `00000000-0000-4000-8000-0000000f${String(index).padStart(4, "0")}`,
			organizationId: orgId,
			channelId: generalChannelId,
			messageId: null,
			fileName: file.name,
			fileSize: file.size,
			externalUrl: file.url ?? `https://files.hazel.test/${file.name}`,
			uploadedBy: uploader(index),
			status: "complete",
			uploadedAt: new Date(NOW - file.daysAgo * DAY - 60 * 60 * 1000).toISOString(),
			deletedAt: null,
		})),
	)

/** `/hazel/chat/<general>/files`. */
const fixture: PageFixture = { seed: seedChannelFiles }

export default fixture
