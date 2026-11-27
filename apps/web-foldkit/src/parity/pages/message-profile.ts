import type { ComparePage } from "../compare-entry"

/** PC4: Katherine's profile card (status "Heads down on the launch deck") from her avatar in #general. */
export default {
	flag: "hazel:native:ChatChannel",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="message-list"]',
	wide: true,
	// Wait for the row first: a hover or click while the list still settles scrolls it elsewhere.
	steps: [
		{ waitFor: '[data-hz=message]:has-text("Release notes draft")' },
		{ click: '[data-hz=message]:has-text("Release notes draft") [data-hz-part=avatar]' },
	],
	region: "viewport",
} satisfies ComparePage
