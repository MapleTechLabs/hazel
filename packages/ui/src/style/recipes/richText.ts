import { defineRecipe } from "../recipe.ts"

/**
 * `hz:richText` (`chat/markdown/markdown-view.ts`): each paragraph and list item is a `line` holding
 * its runs; a mention is the kit's chip (`bg-primary/10 text-primary font-medium rounded px-1`),
 * inline code a muted chip, a code block a `bg-muted rounded-lg p-4` well, a quote an indented,
 * muted block. Italic, strike and monospace come from the semantic elements the renderer uses.
 */
export const richText = defineRecipe<
	{},
	never,
	"line" | "marker" | "mention" | "link" | "code" | "strong" | "codeBlock" | "quote"
>({
	primitive: "richText",
	parts: {
		line: "part",
		marker: { kind: "part", in: "line" },
		mention: { kind: "part", in: "line" },
		link: { kind: "part", in: "line" },
		code: { kind: "part", in: "line" },
		strong: { kind: "part", in: "line" },
		codeBlock: "part",
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
			codeBlock: { paddingX: "4", paddingY: "4", radius: "lg", background: "muted", text: "code" },
			quote: { paddingStart: "4", color: "fg-2" },
		},
	},
	options: {},
})
