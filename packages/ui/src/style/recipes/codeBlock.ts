import { defineRecipe } from "../recipe.ts"

/**
 * `hz:codeBlock` (phase 4): a code snippet (`chat/markdown` code blocks, the agents page's MCP URL) with a copy button. Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A1 fills it from today's kit (lane D reviews).
 */
export const codeBlock = defineRecipe<{}, never, "header" | "title" | "copy" | "code">({
	primitive: "codeBlock",
	parts: {
		header: "part",
		title: { kind: "part", in: "header" },
		copy: { kind: "part", in: "header" },
		code: "part",
	},
	base: { root: {} },
	options: {},
})
