import type { ComparePage } from "../compare-entry"

/** Create application with a one-letter name: the validation error. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:CreateBot",
	href: "/hazel/settings/integrations/your-apps",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ click: "text=Create application" }, { fill: 'input[placeholder="My bot"]', text: "D" }],
} satisfies ComparePage
