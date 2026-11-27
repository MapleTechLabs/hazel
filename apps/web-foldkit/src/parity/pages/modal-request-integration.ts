import type { ComparePage } from "../compare-entry"

/** Request an integration: the integrations page's button, a name and URL typed. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:RequestIntegration",
	href: "/hazel/settings/integrations",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: "text=Request integration" },
		{ fill: 'input[placeholder="e.g., Slack, Jira, Notion"]', text: "Linear" },
		{ fill: 'input[placeholder="e.g., https://slack.com"]', text: "https://linear.app" },
	],
} satisfies ComparePage
