import type { ComparePage } from "../compare-entry"

/** Request an integration with a bad URL: the validation error. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:RequestIntegration",
	href: "/hazel/settings/integrations",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: "text=Request integration" },
		{ fill: 'input[placeholder="e.g., Slack, Jira, Notion"]', text: "Linear" },
		{ fill: 'input[placeholder="e.g., https://slack.com"]', text: "not a url" },
	],
} satisfies ComparePage
