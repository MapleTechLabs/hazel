import { defineRecipe } from "../recipe.ts"

/** `hz:popover` (the kit's `popover.ts`): a bordered card; placement and the pinned anchor are the renderer's. */
export const popover = defineRecipe<{}, never, "panel" | "placeholder">({
	primitive: "popover",
	parts: { panel: "part", placeholder: "part" },
	base: {
		root: { layout: "contents" },
		parts: {
			panel: {
				layout: "column",
				rowGap: "2",
				paddingX: "3",
				paddingY: "3",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				color: "fg",
				shadow: "overlay",
			},
		},
	},
	options: {},
	motion: {
		enter: [{ motion: "fadeIn", part: "panel" }],
	},
})
