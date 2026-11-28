import type { PageFixture } from "../page-fixture"

/** `/oauth/bot-install`: Maple's install link; the offline user owns the fixture org. */
const fixture: PageFixture = {
	rpcs: {
		"bot.getInstallRequest": () => ({
			id: "7b2d3c5f-0000-4000-8000-000000000002",
			name: "Maple",
			description: "Error alerts and incident updates from Maple, posted in the channels you pick.",
			avatarUrl: null,
			creatorName: "Maple Labs",
		}),
	},
}

export default fixture
