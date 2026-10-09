import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconChevronDown, IconDots, IconPlus } from "../../icons"
import { button } from "../../ui/button"

/**
 * React Aria `Tree` markup as `SidebarSection tree={...}` and `SidebarTreeItem` render it
 * (`components/ui/sidebar.tsx`), plus the `SectionGroup` header. Default expanded state;
 * drag, collapse and menus are inert.
 */

/** `useDragAndDrop` points every drag button at one hidden description node. */
export const DRAG_DESCRIPTION_ID = "react-aria-description-0"

export const dragDescription = <M>(h: HtmlBuilder<M>): Html =>
	h.div([h.Id(DRAG_DESCRIPTION_ID), h.Style({ display: "none" })], ["Click to start dragging."])

/** A `<Menu>` trigger with its popover closed. */
const menuTriggerAttributes = <M>(h: HtmlBuilder<M>) => [
	h.Attribute("aria-haspopup", "true"),
	h.Attribute("aria-expanded", "false"),
	h.Attribute("data-rac", ""),
]

/** The row actions trigger in channel and DM items. */
export const dotsMenuTrigger = <M>(h: HtmlBuilder<M>): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-xs",
			className: "size-5 text-muted-fg",
			attributes: [h.Attribute("data-slot", "menu-trigger"), ...menuTriggerAttributes(h)],
		},
		[IconDots(h, { className: "size-4" })],
	)

/** `SectionGroup`'s single-action "+" button (no menu). */
export const sectionPlusButton = <M>(h: HtmlBuilder<M>, attributes: ReadonlyArray<Attribute<M>>): Html =>
	button(
		h,
		{
			intent: "plain",
			isCircle: true,
			size: "sq-xs",
			attributes: [h.Attribute("data-rac", ""), ...attributes],
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
			h.button(
				[
					h.Attribute("type", "button"),
					h.Class("flex items-center gap-1 hover:text-fg transition-colors"),
				],
				[
					IconChevronDown(h, {
						className: `size-3 transition-transform ${options.isCollapsed ? "-rotate-90" : ""}`,
					}),
					strong(h, [options.name]),
				],
			),
			options.action,
		],
	)

/** `components/ui/text.tsx` `Strong`. */
export const strong = <M>(h: HtmlBuilder<M>, children: Array<Html | string>, className?: string): Html =>
	h.strong([h.Class(twMerge("font-medium", className))], children)

export interface TreeSectionOptions {
	readonly id: string
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
					h.Attribute("data-rac", ""),
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
				[h.div([h.Class(twMerge("col-span-full rounded-lg transition-all"))])],
			),
		],
	)

export interface TreeRowOptions<M> {
	readonly treeId: string
	readonly key: string
	readonly label: string
	readonly position: number
	readonly setSize: number
	readonly allowsDragging: boolean
	readonly content: Html
	/** The row of the open channel; its item scrolls into view when it mounts. */
	readonly isActive: boolean
	readonly onActiveMount: Attribute<M>
}

/**
 * `SidebarTreeItem` (a level-1 `TreeItem` without children). Keying by active state remounts
 * the row when it becomes active, like `useScrollIntoViewOnActive`'s ref callback.
 */
export const treeRow = <M>(h: HtmlBuilder<M>, options: TreeRowOptions<M>): Html =>
	h.keyed("div")(
		options.isActive ? `${options.key}:active` : options.key,
		[
			...(options.isActive ? [options.onActiveMount] : []),
			h.Attribute("aria-label", options.label),
			h.Attribute("aria-level", "1"),
			h.Attribute("aria-posinset", String(options.position)),
			h.Attribute("aria-setsize", String(options.setSize)),
			h.Class(twMerge("col-span-full outline-none", "grid grid-cols-subgrid", false, undefined)),
			...(options.allowsDragging ? [h.Attribute("data-allows-dragging", "true")] : []),
			h.Attribute("data-key", options.key),
			h.Attribute("data-level", "1"),
			h.Attribute("data-rac", ""),
			...(options.allowsDragging ? [h.Attribute("draggable", "true")] : []),
			h.Id(`${options.treeId}-${options.key}`),
			h.Attribute("role", "row"),
			h.Style({ "--tree-item-level": "1" }),
			h.Attribute("tabindex", "-1"),
		],
		[
			h.div(
				[
					h.Attribute("aria-colindex", "1"),
					h.Attribute("role", "gridcell"),
					h.Style({ display: "contents" }),
				],
				[
					h.div(
						[h.Class("col-span-full grid grid-cols-subgrid")],
						[dragButton(h, options.label, options.allowsDragging), options.content],
					),
				],
			),
		],
	)

/** `<Trigger slot="drag" className="sr-only">`. Only draggable trees label and describe it. */
const dragButton = <M>(h: HtmlBuilder<M>, label: string, allowsDragging: boolean): Html =>
	h.button(
		[
			...(allowsDragging
				? [
						h.Attribute("aria-describedby", DRAG_DESCRIPTION_ID),
						h.Attribute("aria-label", `Drag ${label}`),
					]
				: []),
			h.Class("sr-only"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("slot", "drag"),
			h.Style({ pointerEvents: "none" }),
			h.Attribute("tabindex", "0"),
			h.Attribute("type", "button"),
		],
		["Drag"],
	)
