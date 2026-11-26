import { defineRecipe } from "../recipe.ts"

/**
 * `hz:tabBar`: the selected tab's panel over a bar of tabs, icon above label as on iOS. The bar's top
 * hairline and the badge's place over the icon are the web renderer's (`structure/tabBar.ts`).
 */
export const tabBar = defineRecipe<{}, never, "panel" | "bar" | "tab" | "tabIcon" | "tabLabel" | "tabBadge">({
	primitive: "tabBar",
	parts: {
		panel: "part",
		bar: "part",
		tab: { kind: "part", in: "bar" },
		tabIcon: { kind: "part", in: "tab" },
		tabLabel: { kind: "part", in: "tab" },
		tabBadge: { kind: "part", in: "tab" },
	},
	base: {
		root: { layout: "column", background: "bg", fill: true },
		parts: {
			panel: { layout: "column", grow: true },
			bar: { layout: "row", paddingX: "2", paddingY: "1", background: "sidebar" },
			tab: {
				layout: "column",
				align: "center",
				justify: "center",
				gap: "0.5",
				grow: true,
				minHeight: "12",
				radius: "lg",
				color: "fg-2",
				text: "micro",
				strong: true,
				transition: "fast",
			},
			tabIcon: { size: "5" },
			tabLabel: { truncate: true },
			tabBadge: {
				layout: "row",
				align: "center",
				justify: "center",
				minHeight: "4",
				paddingX: "1",
				radius: "full",
				background: "primary",
				color: "primary-fg",
				text: "micro",
				strong: true,
				numeric: true,
			},
		},
		regular: { parts: { tab: { text: "tiny" } } },
	},
	options: {},
})
