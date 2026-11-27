import type { ComparePage } from "../compare-entry"

/** Create section with a one-letter name: the validation error. Phones have no opener today, so only 1180 mounts. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:CreateSection",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ at: "regular", click: 'button:has-text("HHazel")' },
		{ at: "regular", click: "text=Create section" },
		{ at: "regular", fill: 'input[placeholder="Design"]', text: "L" },
	],
} satisfies ComparePage
