import { defineRecipe } from "../recipe.ts"

/** `hz:divider` (`separator.styles.ts`, horizontal): a hairline across its container, `bg-border`. */
export const divider = defineRecipe<{}, never, never>({
	primitive: "divider",
	parts: {},
	base: { root: { fill: true, minHeight: "px", background: "border", shrink: false } },
	options: {},
})
