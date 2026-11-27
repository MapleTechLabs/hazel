import { defineRecipe } from "../recipe.ts"

/**
 * `textField` (`input.styles.ts`, `field.styles.ts`): a caption over the field's box, then description
 * and error lines. The box (`control`) carries the fill and the edge; inside it sit the prefix, the
 * input, the suffix (`inputGroup`'s muted text) and the reveal and copy buttons. The focus edge and
 * halo are the renderer's (`styles.ts`).
 */
export const textField = defineRecipe<
	{},
	"readOnly" | "required" | "monospace" | "invalid" | "copied",
	| "label"
	| "caption"
	| "required"
	| "control"
	| "prefix"
	| "input"
	| "suffix"
	| "reveal"
	| "copy"
	| "description"
	| "error"
>({
	primitive: "textField",
	parts: {
		label: "part",
		caption: { kind: "part", in: "label" },
		required: { kind: "part", in: "label" },
		control: { kind: "part", in: "label" },
		prefix: { kind: "part", in: "control" },
		input: { kind: "part", in: "control" },
		suffix: { kind: "part", in: "control" },
		reveal: { kind: "part", in: "control" },
		copy: { kind: "part", in: "control" },
		description: "part",
		error: "part",
	},
	base: {
		root: { layout: "column", gap: "1", fill: true },
		parts: {
			label: { layout: "row", wrap: true, gap: "1", fill: true },
			caption: { text: "label", strong: true, color: "fg" },
			required: { text: "label", color: "danger-subtle-fg" },
			control: {
				layout: "row",
				align: "center",
				fill: true,
				gap: "2",
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "field",
				paddingX: { step: "3.5", lessBorder: true },
				transition: "fast",
			},
			prefix: { text: "body", color: "muted-fg", nowrap: true, shrink: false },
			input: {
				grow: true,
				background: "transparent",
				color: "fg",
				text: "body",
				paddingY: { step: "2.5", lessBorder: true },
			},
			suffix: { text: "body", color: "muted-fg", nowrap: true, shrink: false },
			reveal: { size: "5", color: "muted-fg", shrink: false, radius: "sm", transition: "fast" },
			copy: { size: "5", color: "muted-fg", shrink: false, radius: "sm", transition: "fast" },
			description: { text: "caption", color: "muted-fg" },
			error: { text: "caption", color: "danger-subtle-fg" },
		},
		regular: {
			parts: {
				control: { paddingX: { step: "3", lessBorder: true } },
				input: { paddingY: { step: "1.5", lessBorder: true }, leading: "6" },
				reveal: { size: "4" },
				copy: { size: "4" },
			},
		},
		states: { hover: { parts: { control: { background: "field-hover" } } } },
	},
	options: {},
	flags: {
		readOnly: { parts: { control: { background: "muted" } } },
		required: {},
		monospace: { parts: { input: { text: "code" } } },
		invalid: { parts: { control: { borderColor: "invalid-border" } } },
		// The copy button's check while the copy reads as done (the kit's `text-success`).
		copied: { parts: { copy: { color: "success" } } },
	},
	states: { disabled: { parts: { control: { background: "muted" }, input: { color: "muted-fg" } } } },
	inert: ["disabled"],
	motion: {
		enter: [{ motion: "fieldErrorIn", part: "error" }],
	},
})
