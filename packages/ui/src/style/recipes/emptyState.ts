import { defineRecipe } from "../recipe.ts"
import type { EmptyIllustration } from "../schema.ts"

/**
 * `hz:emptyState` (`empty-state.styles.ts`): a centred column, the icon on the kit's neutral `lg`
 * `iconTile` (`size-12 rounded-xl border bg-secondary`, glyph `size-6 text-muted-fg`), a semibold
 * title, a muted description, then the action slot. `squirrel` is the message list's empty state:
 * its picture at half opacity over the title in the larger type.
 */
export const emptyState = defineRecipe<
	{ readonly illustration: EmptyIllustration },
	never,
	"illustration" | "tile" | "icon" | "title" | "description" | "content"
>({
	primitive: "emptyState",
	parts: {
		illustration: "part",
		tile: "part",
		icon: { kind: "part", in: "tile" },
		title: "part",
		description: "part",
		content: "part",
	},
	base: {
		root: {
			layout: "column",
			align: "center",
			justify: "center",
			rowGap: "1",
			paddingY: "14",
			fill: true,
		},
		parts: {
			illustration: { radius: "md", opacity: 0.5, marginBottom: "3" },
			tile: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "12",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "border",
				background: "secondary",
				color: "muted-fg",
				marginBottom: "3",
				shrink: false,
			},
			icon: { size: "6" },
			title: { text: "body", strong: true, color: "fg" },
			description: { text: "label", color: "muted-fg", marginBottom: "3" },
			content: { layout: "row", align: "center", gap: "2" },
		},
	},
	options: {
		illustration: {
			default: "none",
			values: {
				none: {},
				squirrel: { root: { paddingY: "8" }, parts: { title: { text: "title" } } },
			},
		},
	},
})
