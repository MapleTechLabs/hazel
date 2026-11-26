import { defineRecipe } from "../recipe.ts"

/**
 * A sidebar section: `sidebarSection` with a label (`apps/web-foldkit/src/ui/sidebar.ts`). The rows
 * wrap, so a header action (`hz:action`, first in `content`) shares the title's line and each item,
 * filling the width, takes a line of its own.
 */
export const section = defineRecipe<{}, never, "title" | "content">({
	primitive: "section",
	parts: { title: "part", content: "part" },
	base: {
		root: { layout: "row", wrap: true, align: "center", rowGap: "0.5", paddingX: "4", paddingY: "4" },
		parts: {
			title: {
				layout: "row",
				align: "center",
				grow: true,
				paddingX: "2",
				marginBottom: "1",
				radius: "md",
				text: "caption",
				leading: "6",
				strong: true,
				color: "sidebar-title",
			},
			content: { layout: "contents" },
		},
	},
	options: {},
})
