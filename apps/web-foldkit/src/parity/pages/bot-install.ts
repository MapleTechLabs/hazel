import type { ComparePage } from "../compare-entry"

/** `/oauth/bot-install`: Maple's install link, the workspace choice. */
export default {
	flag: "hazel:native:BotInstall",
	href: "/oauth/bot-install?bot_id=7b2d3c5f-0000-4000-8000-000000000002&redirect_uri=https%3A%2F%2Fmaple.dev%2Fcallback&state=s",
	island: '[data-hz="screen"][data-surface="centered"]',
	wide: true,
	region: "viewport",
	steps: [],
} satisfies ComparePage
