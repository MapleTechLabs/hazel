import { defineRecipe } from "../recipe.ts"
import type { ScreenSurface } from "../schema.ts"

/**
 * A screen: a title bar over its content (the spike's channel list, `Theme.swift`'s measured look).
 * Phase 4 (`ui/page-header.ts`): breadcrumbs over the title, a subtitle under it, and `metaRoom`
 * after it, where the web renderer lays the `meta` slot (slots stay in the content parent). The
 * header's grid of those rows is the renderer's.
 */
export const screen = defineRecipe<
	{ readonly surface: ScreenSurface },
	never,
	| "header"
	| "back"
	| "crumbs"
	| "crumb"
	| "crumbSeparator"
	| "title"
	| "metaRoom"
	| "subtitle"
	| "content"
	| "toolbar"
	| "meta"
	| "aside"
>({
	primitive: "screen",
	parts: {
		header: "part",
		back: { kind: "part", in: "header" },
		crumbs: { kind: "part", in: "header" },
		crumb: { kind: "part", in: "crumbs" },
		crumbSeparator: { kind: "part", in: "crumbs" },
		title: { kind: "part", in: "header" },
		metaRoom: { kind: "part", in: "header" },
		subtitle: { kind: "part", in: "header" },
		content: "part",
		toolbar: { kind: "slot", in: "content" },
		meta: { kind: "slot", in: "content" },
		aside: { kind: "slot", in: "content" },
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
				// Room for crumbs and a subtitle; a one-line bar stays 56pt tall (border-box).
				paddingY: "2",
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
			// `breadcrumb`: `gap-1.5 text-muted-fg text-sm`, the current crumb `font-medium text-fg`.
			crumbs: {
				layout: "row",
				align: "center",
				gap: "1.5",
				text: "label",
				color: "muted-fg",
				minWidth: "0",
			},
			crumb: { truncate: true, radius: "sm", transition: "fast" },
			crumbSeparator: { size: "3", shrink: false },
			title: { text: "label", strong: true, color: "fg", opacity: 0.8, truncate: true },
			metaRoom: { shrink: false },
			subtitle: { text: "label", color: "muted-fg" },
			// Sections pad themselves, as in the sidebar; extensions add their own space below.
			content: { layout: "column", paddingY: "3" },
			toolbar: { gap: "1" },
			meta: { layout: "row", align: "center", gap: "2" },
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
				// A docked or phone panel (the assistant): the host's surface shows through (today's split
				// panel, or `bg-overlay` on a phone), and the bar's title is `heading` `subsection` (14/20).
				panel: {
					root: { background: "transparent" },
					parts: {
						header: { gap: "1", paddingX: "4", divider: "border" },
						title: { text: "label", weight: "semibold", opacity: 1 },
						content: { paddingY: "0", grow: true },
					},
				},
				// `auth/layout.ts`: one card (`max-w-sm`) centred beside the `aside` brand panel; the
				// header is `authHeading` (display title, muted `text-sm` subtitle, `mb-8 space-y-2`).
				// The two columns and the card's width are the web renderer's grid.
				centered: {
					root: { background: "bg", paddingX: "6", paddingY: "6" },
					parts: {
						header: {
							minHeight: "0",
							paddingX: "0",
							paddingY: "0",
							borderWidth: "none",
							marginBottom: "8",
						},
						title: { text: "display", weight: "semibold", opacity: 1 },
						// Its children are the card's rows, laid out in the screen's grid.
						content: { layout: "contents", paddingY: "0" },
					},
					regular: { root: { paddingX: "12", paddingY: "12" } },
				},
			},
		},
	},
})
