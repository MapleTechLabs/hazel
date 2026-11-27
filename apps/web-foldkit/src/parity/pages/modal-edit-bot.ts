import type { ComparePage } from "../compare-entry"

/** Edit application: Deploy Bot's menu, Edit. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:EditBot",
	href: "/hazel/settings/integrations/your-apps",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ click: 'button[aria-label="Bot actions"]' }, { click: "text=Edit" }],
} satisfies ComparePage
