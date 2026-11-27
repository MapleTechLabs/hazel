import type { ComparePage } from "../compare-entry"

/** Edit application with a one-letter name: the validation error. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:EditBot",
	href: "/hazel/settings/integrations/your-apps",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="Bot actions"]' },
		{ click: "text=Edit" },
		{ fill: 'input[placeholder="My bot"]', text: "D" },
	],
} satisfies ComparePage
