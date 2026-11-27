import type { ComparePage } from "../compare-entry"

/** Send feedback: the account menu's Feedback, a message typed. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:Feedback",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="Profile"]' },
		{ click: "text=Feedback" },
		{ fill: 'textarea[placeholder="Describe your feedback in detail..."]', text: "Threads load slowly." },
	],
} satisfies ComparePage
