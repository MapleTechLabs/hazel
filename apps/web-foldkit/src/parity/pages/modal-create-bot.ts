import type { ComparePage } from "../compare-entry"

/** Create application: your apps' Create application, a name typed. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:CreateBot",
	href: "/hazel/settings/integrations/your-apps",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: "text=Create application" },
		{ fill: 'input[placeholder="My bot"]', text: "Deploy Bot" },
	],
} satisfies ComparePage
