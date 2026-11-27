import { defineRecipe } from "../recipe.ts"
import type { HeadingLevel, HeadingSize } from "../schema.ts"

/**
 * `hz:heading` (`heading.styles.ts`): `1` is the kit's `display` (a page title), `2` its `title`
 * (a panel or section), `3` its `subsection` (a group). Always `text-fg` and semibold, as the kit.
 */
export const heading = defineRecipe<
	{ readonly level: HeadingLevel; readonly size: HeadingSize },
	never,
	never
>({
	primitive: "heading",
	parts: {},
	base: { root: { color: "fg", weight: "semibold" } },
	options: {
		level: {
			default: "2",
			values: {
				"1": { root: { text: "display" } },
				"2": { root: { text: "title" } },
				"3": { root: { text: "label" } },
			},
		},
		// `large`: the kit's `title` (`text-lg/7`), a page's subject under a way back.
		size: { default: "auto", values: { auto: {}, large: { root: { text: "headline" } } } },
	},
})
