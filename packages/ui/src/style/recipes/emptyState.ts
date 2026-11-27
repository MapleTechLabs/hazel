import { defineRecipe } from "../recipe.ts"
import type { EmptyIllustration } from "../schema.ts"

/**
 * `hz:emptyState` (`empty-state.styles.ts`): a centred column, the icon on the kit's neutral `lg`
 * `iconTile` (`size-12 rounded-xl border bg-secondary`, glyph `size-6 text-muted-fg`), a semibold
 * title, a muted description, then the action slot. `squirrel` is the message list's empty state
 * (`emptyStateView`): its masked picture at half opacity right over a bold mono 20/28 line, `p-4 sm:p-8`.
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
			textAlign: "center",
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
			title: { text: "body", weight: "semibold", color: "fg" },
			description: { text: "label", color: "muted-fg", marginBottom: "3" },
			content: { layout: "row", align: "center", gap: "2" },
		},
	},
	options: {
		illustration: {
			default: "none",
			values: {
				none: {},
				squirrel: {
					root: { paddingX: "4", paddingY: "4", rowGap: "0" },
					parts: {
						illustration: { marginBottom: "0" },
						// A plain block today: a wrapped line starts at its left edge.
						title: { text: "hero", weight: "bold", mono: true, textAlign: "start" },
					},
					regular: { root: { paddingX: "8", paddingY: "8" } },
				},
			},
		},
	},
})
