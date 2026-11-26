import { defineRecipe } from "../recipe.ts"

/**
 * A sidebar row: `sidebarItem` + `sidebarLabel` (`apps/web-foldkit/src/ui/sidebar.ts`), the channel
 * row's emphasized label and its active link (`CHANNEL_ACTIVE`, `shell/channels-sidebar/items.ts`).
 * The host builds `control` (the link or button that is the row's box) with `content` (the renderer's
 * children, so its slots), `title`, `subtitle`, `badge` and `shortcut` inside it. Slot order, the
 * subtitle's second line and the thread elbow are the web renderer's (`structure/item.ts`).
 */
export const item = defineRecipe<
	{ nested: "none" | "middle" | "last" },
	"muted",
	"control" | "content" | "leading" | "title" | "subtitle" | "trailing" | "badge" | "shortcut"
>({
	primitive: "item",
	parts: {
		control: "part",
		content: { kind: "part", in: "control" },
		leading: { kind: "slot", in: "content" },
		trailing: { kind: "slot", in: "content" },
		title: { kind: "part", in: "control" },
		subtitle: { kind: "part", in: "control" },
		badge: { kind: "part", in: "control" },
		shortcut: { kind: "part", in: "control" },
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
			trailing: { layout: "row", align: "center", gap: "1", shrink: false },
			subtitle: { text: "caption", color: "fg-2", truncate: true },
			// `kbd` (`ui/kbd.styles.ts`): a hairline key cap in muted ink.
			shortcut: {
				text: "caption",
				color: "muted-fg",
				paddingX: "1",
				radius: "sm",
				ring: "border",
				numeric: true,
				shrink: false,
			},
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
	options: {
		// A thread under its channel (`threadItem`): a 32px row, `text-sm/5` at every size class.
		nested: {
			default: "none",
			values: {
				none: {},
				middle: { parts: { control: { paddingY: "1.5", text: "label" } } },
				last: { parts: { control: { paddingY: "1.5", text: "label" } } },
			},
		},
	},
	// A muted channel steps back (`opacity-60` on the label), still pressable.
	flags: { muted: { parts: { title: { opacity: 0.6 }, leading: { opacity: 0.6 } } } },
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
		disabled: { parts: { control: { opacity: 0.5 } } },
	},
	inert: ["disabled"],
})
