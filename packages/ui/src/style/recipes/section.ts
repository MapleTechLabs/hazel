import { defineRecipe } from "../recipe.ts"
import type { SectionStyle } from "../schema.ts"

/**
 * A sidebar section: `sidebarSection` with a label (`apps/web-foldkit/src/ui/sidebar.ts`). The rows
 * wrap, so a header action (`hz:action`, first in `content`) shares the title's line and each item,
 * filling the width, takes a line of its own. Collapsed rows and the drop line are the renderer's.
 */
export const section = defineRecipe<
	{ readonly style: SectionStyle },
	never,
	"title" | "label" | "disclosure" | "chevron" | "content"
>({
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
	options: {
		style: {
			default: "sidebar",
			values: {
				sidebar: {},
				// The channel sidebar's (`shell/channels-sidebar/tree.ts`): `pl-2.5 text-muted-fg text-xs/5`, the
				// name medium, its rows 2px under it. A collapsible section draws this look whatever its style.
				tree: {
					parts: {
						title: {
							paddingX: "0",
							paddingStart: "2.5",
							marginBottom: "0",
							leading: "5",
							color: "muted-fg",
						},
					},
				},
				// The DMs tab's (`mobile-dms.ts`): `pt-3` (`pb-1` as its filters), a `heading` `label` inset
				// `px-4` over its rows, which run edge to edge (the renderer bleeds them).
				list: {
					root: { rowGap: "0", paddingY: "0", paddingTop: "3", paddingBottom: "1" },
					parts: {
						title: {
							paddingX: "0",
							marginBottom: "1",
							text: "overline",
							leading: "4",
							uppercase: true,
							color: "fg-2",
						},
					},
				},
				// Settings' eyebrow (`p4-sidebar-eyebrow`, `sectionTitle` in `sidebars.ts` before PH1): a
				// `heading` `label` (`text-xs uppercase tracking-wider`, `fg-2`) 12px in, `pt-3`, then `pb-1`
				// the group's 2px gap and the rows' own `p-4` under it (20px here plus the 2px row gap).
				eyebrow: {
					root: { paddingTop: "3" },
					parts: {
						title: {
							paddingX: "0",
							bleedX: "1",
							marginBottom: "5",
							radius: "none",
							text: "overline",
							leading: "4",
							uppercase: true,
							color: "fg-2",
						},
					},
				},
				// The inbox's group (`notifications/inbox/view.ts`): the label `px-4 py-2`, sticky over the
				// rows while they scroll (the renderer's), then its rows at full width.
				sticky: {
					root: { rowGap: "0", paddingX: "0", paddingY: "0" },
					parts: {
						title: {
							paddingX: "4",
							paddingY: "2",
							marginBottom: "0",
							radius: "none",
							text: "overline",
							leading: "4",
							uppercase: true,
							color: "fg-2",
						},
					},
				},
			},
		},
	},
})
