import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronDown, IconPlus } from "../icons"
import { ariaButton, button } from "./button"
import { semantic } from "./semantic"

/**
 * Today's chat sidebar tree markup (React Aria `Tree` as `SidebarSection tree={...}` renders it), kept
 * as the kit side of the gallery's row specimens (`packages/ui/src/gallery/kit-rows.ts`). The app's
 * channel list is the shell's now (`shared-screens/src/channel-sidebar/`); this goes at Z2.
 */

/** A channel row's active look (`ChannelItem`). */
export const CHANNEL_ACTIVE = "bg-wash-strong faux-medium text-fg **:data-[slot=icon]:text-fg-3"

/** `SectionGroup`'s single-action "+" button (no menu). */
export const sectionPlusButton = <M>(
	h: HtmlBuilder<M>,
	label: string,
	attributes: ReadonlyArray<Attribute<M>>,
): Html =>
	button(
		h,
		{
			intent: "plain",
			isCircle: true,
			size: "sq-xs",
			attributes: [
				h.AriaLabel(label),
				...semantic(h, { kind: "action", label, symbol: "plus" }),
				...attributes,
			],
		},
		[IconPlus(h)],
	)

/** `SectionGroup`'s header; `action` is the "+" button or its menu. */
export const sectionGroupHeader = <M>(
	h: HtmlBuilder<M>,
	options: { readonly name: string; readonly isCollapsed: boolean; readonly action: Html },
): Html =>
	h.div(
		[h.Class("col-span-full flex items-center justify-between gap-x-2 pl-2.5 text-muted-fg text-xs/5")],
		[
			ariaButton(h, { className: "flex items-center gap-1 hover:text-fg active:text-fg" }, [
				IconChevronDown(h, {
					className: `size-3 transition-transform ${options.isCollapsed ? "-rotate-90" : ""}`,
				}),
				strong(h, [options.name]),
			]),
			options.action,
		],
	)

/** `components/ui/text.tsx` `Strong`. */
const strong = <M>(h: HtmlBuilder<M>, children: Array<Html | string>, className?: string): Html =>
	h.strong([h.Class(twMerge("font-medium", className))], children)

export interface TreeSectionOptions {
	readonly id: string
	/** What the section is called (its header's text). */
	readonly title: string
	readonly ariaLabel: string
	readonly header: Html
	readonly allowsDragging: boolean
	readonly rows: ReadonlyArray<Html>
}

/** `SidebarSection` in tree mode: header, then the treegrid inside a `FocusScope`. */
export const treeSection = <M>(h: HtmlBuilder<M>, options: TreeSectionOptions): Html => {
	const isEmpty = options.rows.length === 0
	return h.div(
		[
			...semantic(h, { kind: "section", title: options.title }),
			h.Attribute("data-slot", "sidebar-section"),
			h.Class(
				twMerge(
					"col-span-full flex min-w-0 flex-col gap-y-0.5 **:data-[slot=sidebar-section]:**:gap-y-0",
					"in-data-[state=collapsed]:p-2 p-4",
					undefined,
				),
			),
		],
		[
			options.header,
			h.span([h.Attribute("data-focus-scope-start", "true"), h.Attribute("hidden", "")]),
			h.div(
				[
					h.Attribute("aria-label", options.ariaLabel),
					h.Class(
						twMerge(
							"grid grid-cols-[auto_1fr] gap-y-0.5 in-data-[state=collapsed]:gap-y-1.5",
							"has-[[data-drop-target]]:bg-sidebar-accent/50 has-[[data-drop-target]]:rounded-lg",
						),
					),
					...(options.allowsDragging ? [h.Attribute("data-allows-dragging", "true")] : []),
					...(isEmpty ? [h.Attribute("data-empty", "true")] : []),
					h.Attribute("data-slot", "sidebar-section-inner"),
					h.Id(options.id),
					h.Attribute("role", "treegrid"),
					h.Attribute("tabindex", "0"),
				],
				isEmpty ? [treeEmptyState(h)] : [...options.rows],
			),
			h.span([h.Attribute("data-focus-scope-end", "true"), h.Attribute("hidden", "")]),
		],
	)
}

/** `renderEmptyState` inside React Aria's empty-tree row wrapper. */
const treeEmptyState = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Attribute("role", "row"), h.Style({ display: "contents" }), h.Attribute("aria-level", "1")],
		[
			h.div(
				[h.Attribute("role", "gridcell"), h.Style({ display: "contents" })],
				[h.div([h.Class(twMerge("col-span-full rounded-lg transition-colors"))])],
			),
		],
	)
