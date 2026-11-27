import { defineRecipe } from "../recipe.ts"

/**
 * `hz:dropZone`: today's dashed file target (`custom-emojis/view.ts`, `page/shared/drop-zone.ts`): an
 * icon (`icon`, else picked from `accept`) over a centred label and a caption line, inside a dashed
 * 2px edge, tinted while a file drag is `over` it.
 */
export const dropZone = defineRecipe<{}, "over", "icon" | "text" | "label" | "description">({
	primitive: "dropZone",
	parts: {
		icon: "part",
		text: "part",
		label: { kind: "part", in: "text" },
		description: { kind: "part", in: "text" },
	},
	base: {
		root: {
			layout: "column",
			align: "center",
			fill: true,
			gap: "2",
			paddingX: "4",
			paddingY: "8",
			radius: "lg",
			borderWidth: "thick",
			borderStyle: "dashed",
			borderColor: "border",
			background: "secondary-faint",
			color: "fg",
			textAlign: "center",
			transition: "fast",
		},
		parts: {
			icon: { size: "8", color: "muted-fg", shrink: false },
			text: { layout: "column", align: "center", gap: "0.5" },
			label: { text: "label", strong: true, color: "fg" },
			description: { text: "caption", color: "muted-fg" },
		},
		states: { hover: { root: { borderColor: "border-hover", background: "secondary-band" } } },
	},
	options: {},
	flags: {
		// A file drag over the zone (`border-primary bg-primary/5`; `primary-tint` is 10%).
		over: { root: { borderColor: "primary", background: "primary-tint" } },
	},
	states: { disabled: { root: { opacity: 0.5 } }, loading: { root: { opacity: 0.7 } } },
	inert: ["disabled", "loading"],
})
