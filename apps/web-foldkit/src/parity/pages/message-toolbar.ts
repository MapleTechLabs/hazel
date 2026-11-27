import type { ComparePage } from "../compare-entry"

/** PC4: the hover toolbar on Ada's own "Shipping it." row in #general (quick reactions, edit, delete). */
export default {
	// ChatChannel has no native page: the list has been hazel since phase 3, so both sides draw it.
	flag: "hazel:native:ChatChannel",
	// `generalChannelId` in `apps/ios-hybrid/fixture/snapshot.ts`.
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="message-list"]',
	wide: true,
	// Wait for the row first: a hover or click while the list still settles scrolls it elsewhere.
	steps: [
		{ waitFor: '[data-hz=message]:has-text("Shipping it.")' },
		{ hover: '[data-hz=message]:has-text("Shipping it.") [data-hz-part=text]' },
	],
} satisfies ComparePage
