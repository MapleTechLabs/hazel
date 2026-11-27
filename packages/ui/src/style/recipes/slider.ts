import { defineRecipe } from "../recipe.ts"

/**
 * `hz:slider` (`ui/slider.ts`, `slider.styles.ts`): the label and value text over a `h-1.5` track with
 * its fill and a `size-5` white thumb. Positions along the track, the drag scale and the focus ring are
 * the web renderer's (`controls/choice-styles.ts`).
 */
export const slider = defineRecipe<{}, never, "header" | "label" | "value" | "track" | "fill" | "thumb">({
	primitive: "slider",
	parts: {
		header: "part",
		label: { kind: "part", in: "header" },
		value: { kind: "part", in: "header" },
		track: "part",
		fill: { kind: "part", in: "track" },
		thumb: { kind: "part", in: "track" },
	},
	base: {
		root: { layout: "column", rowGap: "2", fill: true },
		parts: {
			header: { layout: "row", align: "center", gap: "2" },
			label: { text: "label", strong: true, color: "fg", grow: true },
			value: { text: "label", strong: true, numeric: true, color: "muted-fg" },
			track: { fill: true, minHeight: "1.5", radius: "full", background: "secondary" },
			fill: { radius: "full", background: "primary" },
			thumb: {
				size: "5",
				radius: "full",
				borderWidth: "hairline",
				borderColor: "thumb-edge",
				background: "toggle-thumb",
				shadow: "sm",
			},
		},
	},
	options: {},
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
})
