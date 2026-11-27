import type { ComparePage } from "../compare-entry"

/** Regenerate token: Deploy Bot's menu, the confirm. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:RegenerateBotToken",
	href: "/hazel/settings/integrations/your-apps",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ click: 'button[aria-label="Bot actions"]' }, { click: "text=Regenerate token" }],
} satisfies ComparePage
