import type { ComparePage } from "../compare-entry"

/** Set a status: the account menu's Set status, a preset picked. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:SetStatus",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="Profile"]' },
		{ click: "text=Set status" },
		{ click: "text=Commuting" },
	],
} satisfies ComparePage
