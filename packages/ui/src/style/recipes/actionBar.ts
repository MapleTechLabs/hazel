import { defineRecipe } from "../recipe.ts"

/**
 * `hz:actionBar` (phase 4): the bulk-action bar over the page's bottom edge (`page/customers/list/view.ts`
 * `bulkBar`: `gap-1 rounded-xl border bg-overlay p-1.5 text-sm shadow-lg`, the count a primary pill).
 * Its place over the page, the phone's wrap and hiding while closed are the web renderer's.
 */
export const actionBar = defineRecipe<{}, never, "label" | "actions" | "dismiss">({
	primitive: "actionBar",
	parts: {
		label: "part",
		actions: "slot",
		dismiss: "part",
	},
	base: {
		root: {
			layout: "row",
			align: "center",
			gap: "1",
			paddingX: "1.5",
			paddingY: "1.5",
			radius: "xl",
			borderWidth: "hairline",
			borderColor: "border",
			background: "overlay",
			color: "overlay-fg",
			text: "label",
			shadow: "lg",
		},
		parts: {
			// `badge` `primary` `isPill` with `py-1`.
			label: {
				paddingX: "2",
				paddingY: "1",
				radius: "full",
				background: "primary-subtle",
				color: "accent-fg",
				text: "caption",
				strong: true,
				numeric: true,
				nowrap: true,
			},
			actions: { layout: "row", align: "center", gap: "1", wrap: true },
			dismiss: {
				size: "7",
				radius: "lg",
				color: "muted-fg",
				shrink: false,
				transition: "fast",
			},
		},
	},
	options: {},
	motion: { enter: [{ motion: "slideUpIn" }] },
})
