/** Shared by the React and Foldkit apps: keep this file framework-free. */
type Orientation = "horizontal" | "vertical" | undefined

export const tabsStyles = {
	tabs: (orientation: Orientation) => [
		orientation === "vertical" ? "w-full flex-row" : "flex-col",
		"group/tabs flex gap-4 forced-color-adjust-none",
	],
	tabList: (orientation: Orientation) => [
		"[--tab-list-gutter:--spacing(1)]",
		"relative flex forced-color-adjust-none",
		orientation === "horizontal" &&
			"flex-row gap-x-(--tab-list-gutter) rounded-(--tab-list-rounded) border-b py-(--tab-list-gutter)",
		orientation === "vertical" &&
			"min-w-56 shrink-0 flex-col items-start gap-y-(--tab-list-gutter) border-l px-(--tab-list-gutter) [--tab-list-gutter:--spacing(2)]",
	],
	tab: (orientation: Orientation, isLink: boolean) => [
		"group/tab rounded-lg [--tab-gutter:var(--tab-gutter-x)]",
		orientation === "horizontal"
			? "[--tab-gutter-x:--spacing(2.5)] [--tab-gutter-y:--spacing(1)] first:-ml-(--tab-gutter) last:-mr-(--tab-gutter)"
			: "w-full justify-start [--tab-gutter-x:--spacing(4)] [--tab-gutter-y:--spacing(1.5)]",
		"relative isolate flex cursor-default items-center whitespace-nowrap font-medium text-sm/6 outline-hidden transition",
		"px-(--tab-gutter-x) py-(--tab-gutter-y)",
		"*:data-[slot=icon]:mr-2 *:data-[slot=icon]:-ml-0.5 *:data-[slot=icon]:size-4 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-muted-fg selected:*:data-[slot=icon]:text-primary-subtle-fg",
		"selected:text-primary-subtle-fg text-muted-fg hover:bg-secondary selected:hover:bg-primary-subtle hover:text-fg selected:hover:text-primary-subtle-fg focus:ring-0",
		"disabled:opacity-50",
		isLink ? "cursor-pointer" : "cursor-default",
	],
	selectionIndicator: (orientation: Orientation) => [
		"absolute bg-primary-subtle-fg transition-[translate,width,height] duration-200",
		orientation === "horizontal"
			? "right-(--tab-gutter-x) -bottom-[calc(var(--tab-gutter-y)+1px)] left-(--tab-gutter-x) h-[2px]"
			: "top-(--tab-gutter-y) bottom-(--tab-gutter-y) -left-[calc(var(--tab-gutter-x)-var(--tab-list-gutter)+1px)] w-[2px]",
	],
	tabPanel: "flex-1 text-fg text-sm/6 focus-visible:outline-hidden",
}
