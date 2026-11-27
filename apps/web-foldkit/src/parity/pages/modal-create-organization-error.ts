import type { ComparePage } from "../compare-entry"

/** Create a server with a name too short: both fields' errors. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:CreateOrganization",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button[aria-label="Switch organization"]' },
		// The desktop menu nests it under Switch server.
		{ at: "regular", click: "text=Switch server" },
		{ click: "text=Create server" },
		{ fill: 'input[placeholder="Acme Corp"]', text: "ab" },
	],
} satisfies ComparePage
