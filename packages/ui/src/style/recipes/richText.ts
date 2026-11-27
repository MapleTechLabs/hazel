import { defineRecipe } from "../recipe.ts"

/**
 * `hz:richText` (`chat/markdown/markdown-view.ts`): each paragraph and list item is a `line` holding
 * its runs; a mention is the kit's chip (`bg-primary/10 text-primary font-medium rounded px-1`),
 * inline code a muted chip, a code block a `bg-muted rounded-lg p-4` well, a quote an indented,
 * muted block. Italic, strike and monospace come from the semantic elements the renderer uses.
 * A code block's corner holds its language (the `info` pill badge) and a copy chip (`bg-fg/10
 * p-1.5`, the glyph `size-3.5`); the renderer places them and shows the chip on hover.
 */
export const richText = defineRecipe<
	{},
	never,
	| "line"
	| "marker"
	| "mention"
	| "link"
	| "code"
	| "strong"
	| "codeFrame"
	| "codeTools"
	| "codeLanguage"
	| "codeCopy"
	| "codeCopyIcon"
	| "codeBlock"
	| "quote"
>({
	primitive: "richText",
	parts: {
		line: "part",
		marker: { kind: "part", in: "line" },
		mention: { kind: "part", in: "line" },
		link: { kind: "part", in: "line" },
		code: { kind: "part", in: "line" },
		strong: { kind: "part", in: "line" },
		codeFrame: "part",
		codeTools: { kind: "part", in: "codeFrame" },
		codeLanguage: { kind: "part", in: "codeTools" },
		codeCopy: { kind: "part", in: "codeTools" },
		codeCopyIcon: { kind: "part", in: "codeCopy" },
		codeBlock: { kind: "part", in: "codeFrame" },
		quote: "part",
	},
	base: {
		root: { layout: "column", rowGap: "1", text: "body", color: "fg" },
		parts: {
			marker: { paddingX: "1", color: "muted-fg" },
			mention: {
				paddingX: "1",
				radius: "sm",
				background: "primary-subtle",
				color: "accent-fg",
				strong: true,
				transition: "fast",
			},
			link: { color: "accent-fg", transition: "fast" },
			code: { paddingX: "1", radius: "sm", background: "muted", text: "code" },
			strong: { strong: true },
			codeFrame: { layout: "column" },
			codeTools: { layout: "row", align: "center", gap: "2" },
			codeLanguage: {
				layout: "inline-row",
				align: "center",
				paddingX: "2",
				paddingY: "0.5",
				radius: "lg",
				background: "info-subtle",
				color: "info-subtle-fg",
				text: "caption",
				leading: "5",
				strong: true,
				nowrap: true,
			},
			codeCopy: {
				layout: "row",
				align: "center",
				justify: "center",
				paddingX: "1.5",
				paddingY: "1.5",
				radius: "sm",
				background: "fg-tint",
				opacity: 0,
				transition: "normal",
			},
			codeCopyIcon: { size: "3.5" },
			codeBlock: { paddingX: "4", paddingY: "4", radius: "lg", background: "muted", text: "code" },
			quote: { paddingStart: "4", color: "fg-2" },
		},
	},
	options: {},
})
