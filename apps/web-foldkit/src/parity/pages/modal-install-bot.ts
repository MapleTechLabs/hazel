import type { ComparePage } from "../compare-entry"

/** Install by ID: installed apps' Install by ID, an ID typed. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:InstallBotById",
	href: "/hazel/settings/integrations/installed",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: "text=Install by ID" },
		{
			fill: 'input[placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"]',
			text: "00000000-0000-4000-8000-0000000b0001",
		},
	],
} satisfies ComparePage
