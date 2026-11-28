import type { ComparePage } from "../compare-entry"

/**
 * The reaction picker (`@hazel/shared-screens/chat/pickers/EmojiPicker`) opened from the message
 * toolbar's "Add reaction" in #general. It has no route and no flag of its own (the list was hazel
 * before it), so compare it in baseline mode; a phone opens it from the long-press sheet instead.
 */
export default {
	flag: "hazel:native:ReactionPicker",
	// `generalChannelId` in `apps/ios/fixture/snapshot.ts`.
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="message-list"]',
	wide: true,
	region: "viewport",
	steps: [
		// The list anchors at its end once the last row is drawn; shots before that move by a row.
		{ waitFor: "text=Off to update the benchmarks with the release build." },
		// A phone has no hover toolbar; the pointer rests off the rows so none shows hovered.
		{ at: "compact", hover: "text=general >> nth=0" },
		{ at: "regular", hover: '[data-hz="message"] >> nth=-1' },
		{ at: "regular", click: '[data-hz-part="tool"][aria-label="Add reaction"] >> nth=-1' },
		{ at: "regular", waitFor: '[aria-label="Emoji picker"] >> text=Recently used' },
	],
} satisfies ComparePage
