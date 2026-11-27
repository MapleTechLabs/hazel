import { defineRecipe } from "../recipe.ts"
import type { FieldWidth } from "../schema.ts"

/**
 * `searchField` (`search-field.styles.ts`): a leading search icon in the field's fill; while empty,
 * a `shortcut` key cap at its end (the kit's `kbd`, `pk0-search-hint`).
 */
export const searchField = defineRecipe<{ readonly width: FieldWidth }, never, "icon" | "input" | "shortcut">({
	primitive: "searchField",
	parts: { icon: "part", input: "part", shortcut: "part" },
	base: {
		root: {
			layout: "row",
			align: "center",
			fill: true,
			gap: "2",
			radius: "lg",
			// The kit input's transparent hairline: the paddings below are less it.
			borderWidth: "hairline",
			borderColor: "transparent",
			background: "field",
			paddingX: { step: "3", lessBorder: true },
			transition: "fast",
		},
		parts: {
			icon: { size: "5", color: "muted-fg", shrink: false },
			input: {
				grow: true,
				color: "fg",
				text: "body",
				background: "transparent",
				// The kit's input pads from inside its own hairline: its text sits 1px further in.
				paddingStart: "px",
				paddingY: { step: "2.5", lessBorder: true },
			},
			// The customers kit's key cap (`kbd` `sm`), hidden on a phone; the renderer pins it 8px from the end.
			shortcut: {
				hidden: true,
				text: "micro",
				align: "center",
				justify: "center",
				nowrap: true,
				strong: true,
				background: "bg",
				borderWidth: "hairline",
				borderColor: "border",
				radius: "sm",
				shadow: "xs",
				paddingX: "1",
				minHeight: "4.5",
				minWidth: "4.5",
				color: "fg-3",
			},
		},
		regular: {
			root: { paddingX: { step: "2.5", lessBorder: true }, gap: "1.5" },
			parts: {
				icon: { size: "4" },
				input: { paddingY: { step: "1.5", lessBorder: true }, leading: "6" },
				shortcut: { layout: "inline-row" },
			},
		},
		states: { hover: { root: { background: "field-hover" } } },
	},
	options: {
		width: {
			default: "auto",
			values: {
				auto: {},
				narrow: { root: { width: "36", shrink: false } },
				// `w-64 max-md:w-full`: the row's width on the compact size class.
				regular: { regular: { root: { width: "64", shrink: false } } },
			},
		},
	},
})
