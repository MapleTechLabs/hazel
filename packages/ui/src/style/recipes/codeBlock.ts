import { defineRecipe } from "../recipe.ts"

/**
 * `hz:codeBlock` (phase 4): a snippet outside a message, as a message's code block
 * (`markdown-view.ts`: `rounded-lg bg-muted font-mono text-sm`). A header names it (`text-xs
 * text-muted-fg`) and holds the kit's labelled copy button (`copyButton` `showLabel`, `size sm`);
 * the code scrolls sideways unless `wrap`. Highlighting is Prism's (the renderer marks the runs).
 */
export const codeBlock = defineRecipe<{}, never, "header" | "title" | "copy" | "copyIcon" | "code">({
	primitive: "codeBlock",
	parts: {
		header: "part",
		title: { kind: "part", in: "header" },
		copy: { kind: "part", in: "header" },
		copyIcon: { kind: "part", in: "copy" },
		code: "part",
	},
	base: {
		root: { layout: "column", radius: "lg", background: "muted", color: "fg" },
		parts: {
			header: {
				layout: "row",
				align: "center",
				gap: "2",
				paddingX: "3",
				paddingY: "1.5",
				divider: "border",
			},
			title: { text: "caption", color: "muted-fg", grow: true, shrink: true, truncate: true },
			copy: {
				layout: "row",
				align: "center",
				gap: "1",
				minHeight: "6",
				paddingX: "2",
				radius: "md",
				text: "caption",
				strong: true,
				color: "fg",
				background: "fg-tint",
				shrink: false,
				transition: "fast",
			},
			copyIcon: { size: "3.5", shrink: false },
			code: { paddingX: "4", paddingY: "3", text: "code", overflow: "scrollX" },
		},
	},
	options: {},
})
