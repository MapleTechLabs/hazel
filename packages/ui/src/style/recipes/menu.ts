import { defineRecipe } from "../recipe.ts"

/** The parts a menu's panel draws (`web/primitives/overlays/menu-list.ts`); `hz:contextMenu` shares them. */
export const menuListParts = {
	panel: "part",
	group: { kind: "part", in: "panel" },
	groupTitle: { kind: "part", in: "group" },
	// A header group's second line (`p4-menu-header`: the account menu's email under the name).
	groupSubtitle: { kind: "part", in: "group" },
	separator: { kind: "part", in: "panel" },
	item: { kind: "part", in: "group" },
	itemIcon: { kind: "part", in: "item" },
	itemLabel: { kind: "part", in: "item" },
	itemCheck: { kind: "part", in: "item" },
	itemChevron: { kind: "part", in: "item" },
} as const

export type MenuListPart = keyof typeof menuListParts

/**
 * The kit's menu (`apps/web-foldkit/src/ui/menu-view.ts`): a bordered panel, padded rows with a
 * leading icon, a check or a submenu chevron at the end, group titles and hairline separators.
 * Highlight, destructive ink and placement are the renderer's.
 */
export const menuListStyles = {
	panel: {
		layout: "column",
		paddingX: "1",
		paddingY: "1",
		radius: "xl",
		borderWidth: "hairline",
		borderColor: "border",
		background: "bg",
		color: "fg",
		shadow: "overlay",
	},
	group: { layout: "column" },
	groupTitle: { paddingX: "2", paddingY: "1.5", text: "caption", strong: true, color: "muted-fg" },
	// Today's menu header's email (`block truncate font-normal text-muted-fg`); the header's name and
	// padding (`menuHeaderBase`: `px-2.5 py-2 font-medium text-base sm:text-sm`) are the renderer's.
	groupSubtitle: { paddingX: "2.5", text: "body", color: "muted-fg", truncate: true },
	separator: { divider: "separator", marginX: "1", paddingY: "0.5", marginBottom: "1" },
	item: {
		layout: "row",
		align: "center",
		gap: "2",
		minHeight: "9",
		paddingX: "2",
		radius: "md",
		text: "body",
	},
	itemIcon: { size: "4", shrink: false, color: "muted-fg" },
	itemLabel: { grow: true, truncate: true },
	itemCheck: { size: "4", shrink: false },
	itemChevron: { size: "4", shrink: false, color: "muted-fg" },
} as const

export const menu = defineRecipe<
	{},
	never,
	MenuListPart | "content" | "button" | "buttonLabel" | "buttonIcon"
>({
	primitive: "menu",
	parts: {
		...menuListParts,
		content: "part",
		button: "part",
		buttonLabel: { kind: "part", in: "button" },
		buttonIcon: { kind: "part", in: "button" },
	},
	base: {
		root: { layout: "inline-row", align: "center" },
		parts: {
			...menuListStyles,
			content: { layout: "contents" },
			button: {
				layout: "inline-row",
				align: "center",
				gap: "1.5",
				minHeight: "9",
				paddingX: "3",
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				color: "fg",
				text: "label",
				strong: true,
				shadow: "xs",
				transition: "fast",
			},
			buttonIcon: { size: "4", color: "muted-fg" },
		},
		regular: { parts: { item: { minHeight: "8", text: "label" }, button: { minHeight: "8" } } },
	},
	options: {},
	motion: {
		enter: [{ motion: "fadeIn", part: "panel" }],
	},
})
