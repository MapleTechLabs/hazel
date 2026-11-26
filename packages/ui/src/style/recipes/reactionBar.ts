import { defineRecipe } from "../recipe.ts"

/**
 * `reactionBar` (`chat/message/tooltips.ts` `reactionButton`): wrapping pills. A pill of mine
 * (`data-mine` on the pill), its press scale and its count roll are renderer-owned.
 */
export const reactionBar = defineRecipe<{}, "addable", "reaction" | "addReaction">({
	primitive: "reactionBar",
	parts: { reaction: "part", addReaction: "part" },
	base: {
		root: { layout: "row", wrap: true, gap: "1", rowGap: "1" },
		parts: {
			reaction: {
				layout: "inline-row",
				align: "center",
				gap: "1",
				nowrap: true,
				paddingX: "2.5",
				paddingY: "0.5",
				radius: "full",
				text: "label",
				strong: true,
				background: "secondary",
				color: "fg",
				ring: "border",
			},
			addReaction: {
				layout: "inline-row",
				align: "center",
				paddingX: "2",
				paddingY: "0.5",
				radius: "full",
				text: "label",
				background: "secondary",
				color: "muted-fg",
				ring: "border",
			},
		},
	},
	options: {},
	flags: { addable: {} },
})
