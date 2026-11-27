import type { ComparePage } from "../compare-entry"

/** Browse channels: a section's + menu, Join existing channel. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:JoinChannel",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ click: 'button[aria-label="New in Channels"]' }, { click: "text=Join existing channel" }],
} satisfies ComparePage
