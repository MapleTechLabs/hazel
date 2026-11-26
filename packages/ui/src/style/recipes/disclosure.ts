import { defineRecipe } from "../recipe.ts"

/**
 * `hz:disclosure` (phase 4): a header that shows or hides its body (`ui/thought-line.ts`, customers' `disclosure`). Declared by the contract wave: parts and option values
 * are named, every layer is empty until lane A4 fills it from today's kit (lane D reviews).
 */
export const disclosure = defineRecipe<
	{},
	never,
	"header" | "chevron" | "title" | "subtitle" | "trailing" | "body"
>({
	primitive: "disclosure",
	parts: {
		header: "part",
		chevron: { kind: "part", in: "header" },
		title: { kind: "part", in: "header" },
		subtitle: { kind: "part", in: "header" },
		trailing: "slot",
		body: "part",
	},
	base: { root: {} },
	options: {},
})
