import type { ComparePage } from "../compare-entry"

/** Delete application: Deploy Bot's menu, the confirm. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:DeleteBot",
	href: "/hazel/settings/integrations/your-apps",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ click: 'button[aria-label="Bot actions"]' }, { click: "text=Delete" }],
} satisfies ComparePage
