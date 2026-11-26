import { defineRecipe } from "../recipe.ts"

/** `select` (`select.styles.ts`): a caption over the field's fill, a chevron at its end. */
export const select = defineRecipe<{}, "placeholder", "label" | "caption" | "control" | "input" | "icon">({
	primitive: "select",
	parts: {
		label: "part",
		caption: { kind: "part", in: "label" },
		control: { kind: "part", in: "label" },
		input: { kind: "part", in: "control" },
		icon: { kind: "part", in: "control" },
	},
	base: {
		root: { layout: "column", fill: true },
		parts: {
			label: { layout: "column", gap: "1", fill: true },
			caption: { text: "label", strong: true, color: "fg" },
			control: {
				layout: "row",
				align: "center",
				fill: true,
				radius: "lg",
				background: "secondary",
				paddingX: { step: "3.5", lessBorder: true },
				gap: "2",
			},
			input: {
				grow: true,
				color: "fg",
				text: "body",
				background: "transparent",
				paddingY: { step: "2.5", lessBorder: true },
			},
			icon: { size: "4", color: "muted-fg", shrink: false },
		},
		regular: { parts: { input: { paddingY: { step: "1.5", lessBorder: true }, leading: "6" } } },
		states: { hover: { parts: { control: { background: "secondary-hover" } } } },
	},
	options: {},
	flags: { placeholder: { parts: { input: { color: "muted-fg" } } } },
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
})
