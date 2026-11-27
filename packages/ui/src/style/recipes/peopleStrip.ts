import { defineRecipe } from "../recipe.ts"

/**
 * `hz:peopleStrip` (`page/chat-index/mobile-dms.ts`): a snapping row of linked tiles, `gap-3 px-4`,
 * scrolling sideways. A tile is a `size-14 rounded-xl` avatar (the kit's `xl`) over the person's
 * name, `text-xs` and centred. The web renderer owns the snap, the strip's top and bottom padding,
 * the tile's width, the presence dot's cut-out ring and each tile's unread label.
 */
export const peopleStrip = defineRecipe<{}, never, "tile" | "avatar" | "initials" | "presence" | "label">({
	primitive: "peopleStrip",
	parts: {
		tile: "part",
		avatar: { kind: "part", in: "tile" },
		initials: { kind: "part", in: "avatar" },
		presence: { kind: "part", in: "avatar" },
		label: { kind: "part", in: "tile" },
	},
	base: {
		root: { layout: "row", gap: "3", paddingX: "4", overflow: "scrollX" },
		parts: {
			tile: { layout: "column", align: "center", rowGap: "1.5", shrink: false },
			avatar: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "14",
				radius: "xl",
				background: "muted",
				shrink: false,
			},
			presence: { size: "3", radius: "full" },
			label: { fill: true, text: "caption", color: "muted-fg", textAlign: "center", truncate: true },
		},
	},
	options: {},
})
