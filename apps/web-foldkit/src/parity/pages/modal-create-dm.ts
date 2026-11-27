import type { ComparePage } from "../compare-entry"

/** Start a conversation: the DM section's button, one person picked. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:CreateDm",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="Start a conversation"]' },
		{ fill: 'input[placeholder="Search team members..."]', text: "Mar" },
		{ click: "text=Margaret Hamilton >> nth=-1" },
	],
} satisfies ComparePage
