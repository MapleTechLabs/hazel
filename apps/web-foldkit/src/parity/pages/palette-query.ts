import type { ComparePage } from "../compare-entry"

/** The command palette filtering home as the user types. */
export default {
	flag: "hazel:native:CommandPalette",
	href: "/hazel/chat",
	island: "[data-hz=commandPalette]",
	wide: true,
	region: "viewport",
	steps: [{ press: "ControlOrMeta+k" }, { press: "e" }, { press: "n" }, { press: "g" }],
} satisfies ComparePage
