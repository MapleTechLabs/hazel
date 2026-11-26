import { defineRecipe } from "../recipe.ts"

/**
 * A sidebar row: `sidebarItem` + `sidebarLabel` (`apps/web-foldkit/src/ui/sidebar.ts`), the channel
 * row's emphasized label and its active link (`CHANNEL_ACTIVE`, `shell/channels-sidebar/items.ts`).
 * The host builds `control` (the link or button that is the row's box) with `content` (the renderer's
 * children, so its slots), `title` and `badge` inside it.
 */
export const item = defineRecipe<
	{},
	never,
	"control" | "content" | "leading" | "title" | "trailing" | "badge"
>({
	primitive: "item",
	parts: {
		control: "part",
		content: { kind: "part", in: "control" },
		leading: { kind: "slot", in: "content" },
		trailing: { kind: "slot", in: "content" },
		title: { kind: "part", in: "control" },
		badge: { kind: "part", in: "control" },
	},
	base: {
		root: { fill: true },
		parts: {
			control: {
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
				fill: true,
			},
			content: { layout: "contents" },
			leading: { size: "5", color: "fg-2", shrink: false },
			title: { grow: true, truncate: true },
			trailing: { shrink: false },
			// `countBadge` (`ui/count-badge.ts`): the solid brand pill with the unread count.
			badge: {
				layout: "row",
				align: "center",
				justify: "center",
				minHeight: "5",
				paddingX: "1.5",
				radius: "full",
				background: "primary",
				color: "primary-fg",
				text: "tiny",
				strong: true,
				shrink: false,
			},
		},
		regular: { parts: { leading: { size: "4" } } },
		// Before the data states, so `selected` keeps its wash under the pointer (`wash-stacked`).
		states: {
			hover: {
				parts: { control: { background: "wash", color: "fg" }, leading: { color: "fg-3" } },
			},
			pressed: {
				parts: { control: { background: "wash", color: "fg" }, leading: { color: "fg-3" } },
			},
		},
	},
	options: {},
	states: {
		// The active channel row (a `sidebarLink`, medium, with `CHANNEL_ACTIVE`): the stronger wash,
		// faux-medium's stroke, full ink.
		selected: {
			parts: {
				control: { background: "wash-strong", color: "fg", strong: true, stroke: true },
				leading: { color: "fg-3" },
			},
			states: {
				hover: { parts: { control: { background: "wash-stacked" } } },
				pressed: { parts: { control: { background: "wash-stacked" } } },
			},
		},
		emphasized: { parts: { title: { color: "fg", strong: true } } },
	},
	inert: ["disabled"],
})
