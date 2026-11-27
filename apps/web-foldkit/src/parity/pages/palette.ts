import type { ComparePage } from "../compare-entry"

/** The command palette opened from the keyboard on home: recent channels, actions, channels, people, pages. */
export default {
	flag: "hazel:native:CommandPalette",
	href: "/hazel/chat",
	island: "[data-hz=commandPalette]",
	wide: true,
	region: "viewport",
	steps: [{ press: "ControlOrMeta+k" }],
} satisfies ComparePage
