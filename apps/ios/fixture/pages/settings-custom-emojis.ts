import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId, userRows } from "../snapshot"

/** A flat square as a data URL, so the offline build draws each emoji with no network. */
const square = (fill: string) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" rx="12" fill="${fill}"/></svg>`,
	)}`

const NOW = Date.parse("2026-11-26T15:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const emojis = [
	{ name: "shipit", fill: "#7c5cfc", daysAgo: 1, by: 0 },
	{ name: "party_parrot", fill: "#f59e0b", daysAgo: 6, by: 1 },
	{ name: "lgtm", fill: "#22c55e", daysAgo: 40, by: 2 },
]

/** `/hazel/settings/custom-emojis` for the owner: the upload zone over three emojis. */
const fixture: PageFixture = {
	seed: (server) =>
		server.write(
			"org",
			orgId,
			"custom_emojis",
			emojis.map((emoji, index) => {
				const at = new Date(NOW - emoji.daysAgo * DAY).toISOString()
				return {
					id: `0000000e-0000-4000-8000-00000000000${index + 1}`,
					organizationId: orgId,
					name: emoji.name,
					imageUrl: square(emoji.fill),
					createdBy: userRows[emoji.by]?.id ?? adaUserId,
					createdAt: at,
					updatedAt: null,
					deletedAt: null,
				}
			}),
		),
}

export default fixture
