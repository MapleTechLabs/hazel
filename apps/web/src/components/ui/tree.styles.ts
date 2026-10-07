/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const treeStyles = {
	tree: [
		"flex cursor-default flex-col gap-y-2 overflow-auto outline-hidden forced-color-adjust-none",
		"[--tree-active-bg:var(--color-primary-subtle)] [--tree-active-fg:var(--color-primary-subtle-fg)]",
	],
	item: (isLink: boolean) => [
		"shrink-0 rounded-lg px-2 py-1.5 pr-2",
		"group/tree-item relative flex select-none rounded-lg focus:outline-hidden",
		"focus:bg-(--tree-active-bg) focus:text-(--tree-active-fg) focus:**:[.text-muted-fg]:text-(--tree-active-fg)",
		"**:data-[slot=avatar]:*:size-6 **:data-[slot=avatar]:size-6 sm:**:data-[slot=avatar]:*:size-5 sm:**:data-[slot=avatar]:size-5",
		"**:data-[slot=icon]:mr-1 **:data-[slot=icon]:size-5 **:data-[slot=icon]:shrink-0 sm:**:data-[slot=icon]:size-4",
		"disabled:opacity-50 forced-colors:[",
		isLink ? "cursor-pointer" : "cursor-default",
	],
	content: "relative flex w-full min-w-0 items-center gap-x-1 truncate text-sm/6",
	selectionCheckbox: "[--indicator-mt:0] sm:[--indicator-mt:0]",
	levelGuide: [
		"relative w-[calc(calc(var(--tree-item-level)-1)*calc(var(--spacing)*5))] shrink-0",
		"before:absolute before:inset-0 before:-ms-1 before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-item-level)-1px),var(--border)_calc(var(--tree-item-level)-1px),var(--border)_calc(var(--tree-item-level)))]",
	],
	leafSpacer: "block w-5 shrink-0",
	indicator: (isExpanded: boolean | undefined) => [
		"shrink-0 content-center text-muted-fg hover:text-fg",
		isExpanded && "text-fg",
	],
	chevron: (isExpanded: boolean | undefined) => [
		"size-4 transition-transform duration-200 ease-in-out sm:size-5",
		isExpanded && "rotate-90",
	],
}
