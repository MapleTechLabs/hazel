import type { ComparePage } from "../compare-entry"

/** The command palette's search with a `from:` filter picked from the suggestions. */
export default {
	flag: "hazel:native:CommandPalette",
	href: "/hazel/chat",
	island: "[data-hz=commandPalette]",
	wide: true,
	region: "viewport",
	steps: [
		{ press: "ControlOrMeta+Shift+f" },
		{ click: "[data-hz=commandPalette] input[type=search], [role=dialog] [contenteditable=true]" },
		{ press: "f" },
		{ press: "r" },
		{ press: "o" },
		{ press: "m" },
		{ press: ":" },
		{ press: "g" },
		{ press: "r" },
		{ press: "Enter" },
	],
} satisfies ComparePage
