import { defineRecipe } from "../recipe.ts"
import type { TabBarStyle } from "../schema.ts"

/**
 * `hz:tabBar`: the selected tab's panel over a bar of tabs, icon above label as on iOS. The bar's top
 * hairline and the badge's place over the icon are the web renderer's (`structure/tabBar.ts`).
 * Phase 4 `page`: in-page tabs over the panel (`components/ui/tabs.styles.ts` horizontal, with
 * `customers/ui/filter-bar.ts`'s counts); the selected tab's colour and underline, the hover and the
 * drop line are the renderer's (per-tab states).
 */
export const tabBar = defineRecipe<
	{ readonly style: TabBarStyle },
	never,
	"panel" | "bar" | "tab" | "tabIcon" | "tabLabel" | "tabBadge"
>({
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
	options: {
		style: {
			default: "app",
			values: {
				app: {},
				// `flex-col gap-4`; the list `gap-x-1 border-b py-1`; a tab `rounded-lg px-2.5 py-1
				// font-medium text-sm/6 text-muted-fg`, its icon `size-4`, its count `text-xs tabular-nums`.
				page: {
					root: { background: "transparent", rowGap: "4" },
					parts: {
						bar: {
							paddingX: "0",
							paddingY: "1",
							gap: "1",
							background: "transparent",
							divider: "border",
						},
						tab: {
							layout: "row",
							gap: "1.5",
							grow: false,
							shrink: false,
							minHeight: "0",
							paddingX: "2.5",
							paddingY: "1",
							color: "muted-fg",
							text: "label",
							leading: "6",
							nowrap: true,
						},
						tabIcon: { size: "4" },
						tabBadge: {
							minHeight: "0",
							paddingX: "0",
							radius: "none",
							background: "transparent",
							color: "muted-fg",
							text: "caption",
							strong: false,
						},
					},
					regular: { parts: { tab: { text: "label" } } },
				},
			},
		},
	},
})
