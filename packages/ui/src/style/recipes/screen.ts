import { defineRecipe } from "../recipe.ts"
import type { ScreenSurface } from "../schema.ts"

/** A screen: a title bar over its content (the spike's channel list, `Theme.swift`'s measured look). */
export const screen = defineRecipe<
	{ readonly surface: ScreenSurface },
	never,
	"header" | "back" | "title" | "content" | "toolbar"
>({
	primitive: "screen",
	parts: {
		header: "part",
		back: { kind: "part", in: "header" },
		title: { kind: "part", in: "header" },
		content: "part",
		toolbar: { kind: "slot", in: "content" },
	},
	base: {
		root: { layout: "column", background: "sidebar" },
		parts: {
			header: {
				layout: "row",
				align: "center",
				gap: "2",
				minHeight: "14",
				paddingX: "6",
				divider: "separator",
			},
			// The back button: a quiet square, as a section's header action.
			back: {
				size: "8",
				paddingX: "2",
				radius: "lg",
				color: "fg-3",
				bleedX: "2",
				shrink: false,
				transition: "fast",
			},
			title: { text: "label", strong: true, color: "fg", opacity: 0.8 },
			// Sections pad themselves, as in the sidebar; extensions add their own space below.
			content: { layout: "column", paddingY: "3" },
			toolbar: { gap: "1" },
		},
	},
	options: {
		surface: {
			default: "sidebar",
			values: {
				sidebar: {},
				// A phone tab (`ui/mobile-top-bar.ts`): `h-14 gap-1 border-b bg-bg pl-4`, the title
				// `heading` `section` (16/24 semibold, tight), and content that pads itself.
				page: {
					root: { background: "bg" },
					parts: {
						header: { gap: "1", paddingX: "4", divider: "border" },
						title: { text: "title", weight: "semibold", opacity: 1 },
						content: { paddingY: "0", grow: true },
					},
				},
			},
		},
	},
})
