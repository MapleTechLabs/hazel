import { defineRecipe } from "../recipe.ts"

/** `textArea` (`textarea.styles.ts`): the text field's look over a multi-line input. */
export const textArea = defineRecipe<
	{},
	"invalid",
	"label" | "caption" | "required" | "input" | "description" | "error"
>({
	primitive: "textArea",
	parts: {
		label: "part",
		caption: { kind: "part", in: "label" },
		required: { kind: "part", in: "label" },
		input: { kind: "part", in: "label" },
		description: "part",
		error: "part",
	},
	base: {
		root: { layout: "column", gap: "1", fill: true },
		parts: {
			label: { layout: "row", wrap: true, gap: "1", fill: true },
			caption: { text: "label", strong: true, color: "fg" },
			required: { text: "label", color: "danger-subtle-fg" },
			input: {
				fill: true,
				minHeight: "14",
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "secondary",
				color: "fg",
				text: "body",
				paddingX: { step: "3.5", lessBorder: true },
				paddingY: { step: "2.5", lessBorder: true },
				transition: "fast",
			},
			description: { text: "caption", color: "muted-fg" },
			error: { text: "caption", color: "danger-subtle-fg" },
		},
		regular: {
			parts: {
				input: {
					paddingX: { step: "3", lessBorder: true },
					paddingY: { step: "1.5", lessBorder: true },
				},
			},
		},
		states: { hover: { parts: { input: { background: "secondary-hover" } } } },
	},
	options: {},
	flags: { invalid: { parts: { input: { borderColor: "danger-subtle-fg" } } } },
	states: { disabled: { parts: { input: { background: "muted", color: "muted-fg" } } } },
	inert: ["disabled"],
})
