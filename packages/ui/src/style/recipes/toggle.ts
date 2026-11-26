import { defineRecipe } from "../recipe.ts"

/**
 * `toggle` (`switch.styles.ts`): label and description beside the track; `selected` is on. The
 * thumb's slide is renderer motion; the recipe sets the track and thumb fills.
 */
export const toggle = defineRecipe<{}, never, "text" | "label" | "description" | "control" | "thumb">({
	primitive: "toggle",
	parts: {
		text: "part",
		label: { kind: "part", in: "text" },
		description: { kind: "part", in: "text" },
		control: "part",
		thumb: { kind: "part", in: "control" },
	},
	base: {
		root: { layout: "row", gap: "6", fill: true },
		parts: {
			text: { layout: "column", gap: "1", grow: true },
			label: { text: "body", strong: true, color: "fg" },
			description: { text: "caption", color: "muted-fg" },
			control: {
				layout: "row",
				shrink: false,
				radius: "full",
				background: "secondary-hover",
				paddingX: "0.5",
				paddingY: "0.5",
				// `switch.styles.ts`: `transition duration-200 ease-in-out`.
				transition: "normal",
				transitionEase: "inOut",
			},
			thumb: { size: "4.5", radius: "full", background: "bg", shadow: "xs" },
		},
		regular: { parts: { thumb: { size: "3.5" } } },
	},
	options: {},
	states: {
		selected: { parts: { control: { background: "primary" } } },
		disabled: { root: { opacity: 0.5 } },
	},
	inert: ["disabled"],
})
