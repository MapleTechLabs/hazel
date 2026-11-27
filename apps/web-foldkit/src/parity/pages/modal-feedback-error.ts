import type { ComparePage } from "../compare-entry"

/** Send feedback with a message too short: the validation error. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:Feedback",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="Profile"]' },
		{ click: "text=Feedback" },
		{ fill: 'textarea[placeholder="Describe your feedback in detail..."]', text: "bug" },
	],
} satisfies ComparePage
