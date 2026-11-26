import { defineRecipe } from "../recipe.ts"

/**
 * A sidebar section: `sidebarSection` with a label (`apps/web-foldkit/src/ui/sidebar.ts`). The rows
 * wrap, so a header action (`hz:action`, first in `content`) shares the title's line and each item,
 * filling the width, takes a line of its own. Collapsed rows and the drop line are the renderer's.
 */
export const section = defineRecipe<{}, never, "title" | "label" | "disclosure" | "chevron" | "content">({
	primitive: "section",
	parts: {
		title: "part",
		label: { kind: "part", in: "title" },
		disclosure: { kind: "part", in: "title" },
		chevron: { kind: "part", in: "disclosure" },
		content: "part",
	},
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
			label: { truncate: true },
			// Collapsible, the title is a disclosure: the label and a chevron (renderer-rotated).
			disclosure: {
				layout: "inline-row",
				align: "center",
				gap: "1",
				color: "sidebar-title",
				transition: "fast",
			},
			chevron: { size: "3", color: "fg-2" },
			content: { layout: "contents" },
		},
	},
	options: {},
})
