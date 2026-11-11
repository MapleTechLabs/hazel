import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { tabsStyles } from "~/components/ui/tabs.styles"

/**
 * A horizontal tab list whose selection is the route (the chat tab bar and the channel settings
 * tabs). Hover and focus rings are native CSS; `ui/tabs.ts` is the stateful kit.
 */

export const tabView = <M>(
	h: HtmlBuilder<M>,
	options: {
		readonly id: string
		readonly label: string
		readonly icon?: Html
		readonly isSelected: boolean
		readonly attributes?: ReadonlyArray<Attribute<M>>
	},
): Html =>
	h.div(
		[
			h.AriaSelected(options.isSelected),
			...(options.isSelected ? [h.DataAttribute("selected", "true")] : []),
			h.Class(twMerge(tabsStyles.tab("horizontal", false))),
			h.DataAttribute("key", options.id),
			h.DataAttribute("slot", "tab"),
			h.Role("tab"),
			h.Tabindex(options.isSelected ? 0 : -1),
			...(options.attributes ?? []),
		],
		[
			...(options.icon ? [options.icon] : []),
			options.label,
			...(options.isSelected
				? [
						h.div([
							h.Class(twMerge(tabsStyles.selectionIndicator("horizontal"))),
							h.DataAttribute("slot", "selected-indicator"),
						]),
					]
				: []),
		],
	)

/** `Tabs` (horizontal) wrapping one `TabList`. */
export const tabStrip = <M>(
	h: HtmlBuilder<M>,
	options: { readonly className?: string; readonly tabListClassName?: string },
	tabs: ReadonlyArray<Html>,
): Html =>
	h.div(
		[
			h.Class(twMerge(tabsStyles.tabs("horizontal"), options.className)),
			h.DataAttribute("orientation", "horizontal"),
		],
		[
			h.div(
				[
					h.AriaOrientation("horizontal"),
					h.Class(twMerge(tabsStyles.tabList("horizontal"), options.tabListClassName)),
					h.DataAttribute("orientation", "horizontal"),
					h.DataAttribute("slot", "tab-list"),
					h.Role("tablist"),
				],
				[...tabs],
			),
		],
	)
