import { defineRecipe } from "../recipe.ts"

/** A sidebar section: `sidebarSection` with a label (`apps/web-foldkit/src/ui/sidebar.ts`). */
export const section = defineRecipe<{}, never, "header" | "content">({
	primitive: "section",
	parts: { header: "part", content: "part" },
	base: {
		root: { layout: "column", rowGap: "0.5", paddingX: "4", paddingY: "4" },
		parts: {
			header: {
				layout: "row",
				align: "center",
				paddingX: "2",
				marginBottom: "1",
				radius: "md",
				text: "caption",
				leading: "6",
				strong: true,
				color: "sidebar-title",
				shrink: false,
			},
			content: { layout: "column", rowGap: "0.5" },
		},
	},
	options: {},
})
