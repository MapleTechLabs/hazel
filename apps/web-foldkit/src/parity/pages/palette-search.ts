import type { ComparePage } from "../compare-entry"

/** The command palette's message search: local rows and the server's hits (`fixture/pages/palette-search.ts`). */
export default {
	flag: "hazel:native:CommandPalette",
	href: "/hazel/chat",
	island: "[data-hz=commandPalette]",
	wide: true,
	region: "viewport",
	steps: [
		{ press: "ControlOrMeta+Shift+f" },
		{ click: "[data-hz=commandPalette] input[type=search], [role=dialog] [contenteditable=true]" },
		{ press: "r" },
		{ press: "e" },
		{ press: "l" },
		{ press: "e" },
		{ press: "a" },
		{ press: "s" },
		{ press: "e" },
	],
} satisfies ComparePage
