import { defineRecipe } from "../recipe.ts"

/**
 * A sidebar row: `sidebarItem` + `sidebarLabel` (`apps/web-foldkit/src/ui/sidebar.ts`) and the channel
 * row's emphasized label (`shell/channels-sidebar/items.ts`). `selected` is the kit's `isCurrent`.
 */
export const item = defineRecipe<{}, never, "leading" | "title" | "trailing">({
	primitive: "item",
	parts: { leading: "slot", title: "part", trailing: "slot" },
	base: {
		root: {
			layout: "row",
			align: "center",
			gap: "2",
			paddingX: "2",
			paddingY: "2",
			radius: "lg",
			text: "body",
			strong: false,
			color: "fg-3",
			transition: "fast",
		},
		parts: {
			leading: { size: "5", color: "fg-2", shrink: false },
			title: { grow: true, truncate: true },
			trailing: { shrink: false },
		},
		regular: { parts: { leading: { size: "4" } } },
	},
	options: {},
	states: {
		// The kit's tint (`hover:bg-(--sidebar-current-bg)`) loses to `hover:bg-wash` in twMerge: no fill.
		selected: {
			root: { color: "sidebar-primary-fg", strong: true },
			parts: { leading: { color: "sidebar-primary-fg" } },
		},
		emphasized: { parts: { title: { color: "fg", strong: true } } },
		hover: { root: { background: "wash", color: "fg" }, parts: { leading: { color: "fg-3" } } },
		pressed: { root: { background: "wash", color: "fg" }, parts: { leading: { color: "fg-3" } } },
	},
	inert: ["disabled"],
})
