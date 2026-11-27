import type { ComparePage } from "../compare-entry"

/** Create channel with a name too short: the validation error. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:NewChannel",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="New in Channels"]' },
		{ click: "text=Create new channel" },
		{ fill: 'input[placeholder="general"]', text: "ab" },
	],
} satisfies ComparePage
