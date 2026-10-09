import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cx } from "~/utils/cx"

/**
 * Stateless `Tabs` > `TabList` > `Tab` (`components/ui/tabs.tsx`, horizontal) for tab bars whose
 * selection is the route: the chat tab bar and the channel settings tabs. `ui/tabs.ts` is the stateful kit.
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
			...(options.isSelected
				? [h.Attribute("aria-selected", "true"), h.Attribute("data-selected", "true")]
				: [h.Attribute("aria-selected", "false")]),
			h.Class(
				twMerge(
					twMerge(
						"group/tab rounded-lg [--tab-gutter:var(--tab-gutter-x)]",
						"[--tab-gutter-x:--spacing(2.5)] [--tab-gutter-y:--spacing(1)] first:-ml-(--tab-gutter) last:-mr-(--tab-gutter)",
						"relative isolate flex cursor-default items-center whitespace-nowrap font-medium text-sm/6 outline-hidden transition",
						"px-(--tab-gutter-x) py-(--tab-gutter-y)",
						"*:data-[slot=icon]:mr-2 *:data-[slot=icon]:-ml-0.5 *:data-[slot=icon]:size-4 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-muted-fg selected:*:data-[slot=icon]:text-primary-subtle-fg",
						"selected:text-primary-subtle-fg text-muted-fg hover:bg-secondary selected:hover:bg-primary-subtle hover:text-fg selected:hover:text-primary-subtle-fg focus:ring-0",
						"disabled:opacity-50",
						"cursor-default",
					),
				),
			),
			h.Attribute("data-key", options.id),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("data-slot", "tab"),
			h.Attribute("role", "tab"),
			h.Attribute("tabindex", options.isSelected ? "0" : "-1"),
			...(options.attributes ?? []),
		],
		[
			...(options.icon ? [options.icon] : []),
			options.label,
			...(options.isSelected
				? [
						h.div([
							h.Class(
								twMerge(
									"absolute bg-primary-subtle-fg transition-[translate,width,height] duration-200",
									"right-(--tab-gutter-x) -bottom-[calc(var(--tab-gutter-y)+1px)] left-(--tab-gutter-x) h-[2px]",
								),
							),
							h.Attribute("data-rac", ""),
							h.Attribute("data-slot", "selected-indicator"),
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
			h.Class(cx("flex-col", "group/tabs flex gap-4 forced-color-adjust-none", options.className)),
			h.Attribute("data-orientation", "horizontal"),
			h.Attribute("data-rac", ""),
		],
		[
			h.div(
				[
					h.Attribute("aria-orientation", "horizontal"),
					h.Class(
						twMerge([
							"[--tab-list-gutter:--spacing(1)]",
							"relative flex forced-color-adjust-none",
							"flex-row gap-x-(--tab-list-gutter) rounded-(--tab-list-rounded) border-b py-(--tab-list-gutter)",
							options.tabListClassName,
						]),
					),
					h.Attribute("data-orientation", "horizontal"),
					h.Attribute("data-rac", ""),
					h.Attribute("data-slot", "tab-list"),
					h.Attribute("role", "tablist"),
				],
				[...tabs],
			),
		],
	)
