import type { ComparePage } from "../compare-entry"

/** The command palette's search reopened after a result was opened: the recent searches. */
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
		{ press: "ArrowDown" },
		{ press: "Enter" },
		{ press: "ControlOrMeta+Shift+f" },
	],
} satisfies ComparePage
