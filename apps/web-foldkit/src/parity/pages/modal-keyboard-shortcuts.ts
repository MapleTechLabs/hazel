import type { ComparePage } from "../compare-entry"

/** Keyboard shortcuts: Mod+/ over the chat. Flag `"0"` opens today's Foldkit modal. */
export default {
	flag: "hazel:native:modal:KeyboardShortcuts",
	href: "/hazel/chat",
	island: '[data-hz="dialog"]',
	wide: true,
	region: "viewport",
	steps: [{ press: "ControlOrMeta+/" }],
} satisfies ComparePage
