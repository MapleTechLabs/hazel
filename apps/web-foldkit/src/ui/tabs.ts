import { Tabs } from "@foldkit/ui"
import { Array } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { tabsStyles } from "~/components/ui/tabs.styles"

/**
 * The `@foldkit/ui` Tabs, styled. The parent owns the selected tab: it passes it to the view as
 * `viewInputs.selectedValue` and stores it on the `Selected` OutMessage. The Submodel holds only the
 * roving focus. `layout` is the `toView` that draws the tab list and the active panel with the kit's
 * classes; hover and focus rings are native CSS.
 */
export const { Model, Message, OutMessage, init, create, FocusTab } = Tabs
export type Model = Tabs.Model
export type Message = Tabs.Message
export type OutMessage<Value extends string = string> = Tabs.OutMessage<Value>
export type RenderInfo<Value extends string = string> = Tabs.RenderInfo<Value>

export const layout = <M, Value extends string>(
	h: HtmlBuilder<M>,
	render: RenderInfo<Value>,
	options: {
		readonly tab: (value: Value) => ReadonlyArray<Html | string>
		readonly panel: (value: Value) => ReadonlyArray<Html | string>
		readonly className?: string
		readonly listClassName?: string
	},
): Html =>
	h.div(
		[
			h.Class(twMerge(twMerge(...tabsStyles.tabs("horizontal")), options.className)),
			h.DataAttribute("orientation", "horizontal"),
		],
		[
			h.div(
				[
					...render.tablist,
					h.Class(twMerge([...tabsStyles.tabList("horizontal"), options.listClassName])),
					h.DataAttribute("slot", "tab-list"),
				],
				Array.map(render.tabs, (info) =>
					h.keyed("button")(
						info.value,
						[
							...info.tab,
							h.Class(twMerge(...tabsStyles.tab("horizontal", false))),
							h.DataAttribute("slot", "tab"),
						],
						[
							...options.tab(info.value),
							...(info.isActive
								? [
										h.div([
											h.Class(twMerge(tabsStyles.selectionIndicator("horizontal"))),
											h.DataAttribute("slot", "selected-indicator"),
										]),
									]
								: []),
						],
					),
				),
			),
			...Array.map(
				Array.filter(render.tabs, (info) => info.isActive),
				(info) =>
					h.keyed("div")(
						info.value,
						[
							...info.panel,
							h.Class(twMerge(tabsStyles.tabPanel)),
							h.DataAttribute("slot", "tab-panel"),
						],
						[...options.panel(info.value)],
					),
			),
		],
	)
