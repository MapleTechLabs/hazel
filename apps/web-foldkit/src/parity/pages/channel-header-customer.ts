import type { ComparePage } from "../compare-entry"

/** #support, linked to the customer Linear and synced with Slack: the chip and its card pressed open. */
export default {
	flag: "hazel:native:ChatChannel",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000003",
	island: '[data-hazel-hole="channel-header"]',
	wide: true,
	region: "viewport",
	steps: [
		{ waitFor: '[aria-label^="Notification settings"]' },
		{ click: ':is([aria-label="Customer: Linear"], [data-hz="button"]:has-text("Linear"))' },
	],
} satisfies ComparePage
