import type { ComparePage } from "../compare-entry"

/** Change role: the team page's first member's Change role. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:ChangeRole",
	href: "/hazel/settings/team",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ click: 'button[aria-label^="Change role for"]' }],
} satisfies ComparePage
