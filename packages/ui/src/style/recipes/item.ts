import { defineRecipe } from "../recipe.ts"

/**
 * A sidebar row: `sidebarItem` + `sidebarLabel` (`apps/web-foldkit/src/ui/sidebar.ts`), the channel
 * row's emphasized label and its active link (`CHANNEL_ACTIVE`, `shell/channels-sidebar/items.ts`).
 * The host builds `control` (the link or button that is the row's box) with `content` (the renderer's
 * children, so its slots), `title`, `subtitle`, `badge` and `shortcut` inside it. Slot order, the
 * subtitle's second line and the thread elbow are the web renderer's (`structure/item.ts`).
 */
export const item = defineRecipe<
	{
		nested: "none" | "middle" | "last"
		titleLines: "1" | "2"
		subtitleLines: "1" | "2"
		leadingSize: "regular" | "large" | "conversation"
	},
	"muted",
	"control" | "content" | "leading" | "title" | "subtitle" | "trailing" | "badge" | "count" | "shortcut"
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
		// The number inside the badge, re-keyed on a change so it can roll (`structure/item.ts`).
		count: { kind: "part", in: "badge" },
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
				// No transition: today's sidebar rows switch colours at once (`ui/sidebar.ts`); activity's
				// large rows ease them (`structure/item.ts`).
				fill: true,
			},
			content: { layout: "contents" },
			leading: { size: "5", color: "fg-2", shrink: false },
			title: { grow: true, truncate: true },
			trailing: { layout: "row", align: "center", gap: "1", shrink: false },
			subtitle: { text: "caption", color: "fg-2", truncate: true },
			// The sidebar's palette hint (`channels-sidebar/view.ts`): bare `font-mono text-xs` in muted ink;
			// its family, its place at the row's end and its breakpoint are the renderer's.
			shortcut: { text: "caption", color: "muted-fg", shrink: false },
			// `countBadge` (`ui/count-badge.ts`): the solid brand pill with the unread count, round at
			// one digit (`min-w-5`), tabular figures.
			badge: {
				layout: "row",
				align: "center",
				justify: "center",
				minHeight: "5",
				minWidth: "5",
				numeric: true,
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
		// Two lines wrap and clamp (`item-title-lines`, `item-subtitle-lines`).
		titleLines: { default: "1", values: { "1": {}, "2": { parts: { title: { lineClamp: 2 } } } } },
		subtitleLines: { default: "1", values: { "1": {}, "2": { parts: { subtitle: { lineClamp: 2 } } } } },
		// Today's activity row (`item-leading-size`): square, `py-3 px-4`, 14/20 in full ink, muted context.
		// The grid, the 40pt column and the dot's column are the renderer's.
		leadingSize: {
			default: "regular",
			values: {
				// A sidebar row that links takes today's link weight (`sidebarLink`'s `font-medium`).
				regular: { states: { linked: { parts: { control: { strong: true } } } } },
				large: {
					parts: {
						control: { paddingX: "4", paddingY: "3", radius: "none", text: "label", color: "fg" },
						title: { color: "fg" },
						subtitle: { color: "muted-fg" },
					},
				},
				// Today's DM row (`item-conversation-row`, `mobile-dms.ts`): `py-2.5 px-4`, a medium title,
				// a 14/19.25 preview; unread, the title semibold and the preview in full ink.
				conversation: {
					parts: {
						control: {
							paddingX: "4",
							paddingY: "2.5",
							radius: "none",
							text: "label",
							color: "fg",
						},
						title: { color: "fg", strong: true },
						subtitle: { text: "snug", color: "muted-fg" },
					},
					states: {
						emphasized: { parts: { title: { weight: "semibold" }, subtitle: { color: "fg" } } },
					},
				},
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
	// A muted conversation's name is muted ink, not faded (`mobile-dms.ts`).
	compounds: [
		{
			when: { leadingSize: "conversation", muted: true },
			style: { parts: { title: { opacity: 1, color: "muted-fg" }, leading: { opacity: 1 } } },
		},
	],
	inert: ["disabled"],
	// The unread count rolls to its new value (`MOTION.md`, "Counts": reaction pills roll today).
	motion: {
		countUp: [{ motion: "countUp", part: "count" }],
		countDown: [{ motion: "countDown", part: "count" }],
	},
})
