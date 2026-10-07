/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const tableStyles = {
	root: "w-full min-w-full caption-bottom text-sm/6 outline-hidden [--table-selected-bg:var(--color-secondary)]/50",
	scroller:
		"relative -mx-(--gutter) overflow-x-auto whitespace-nowrap [--gutter-y:--spacing(2)] has-data-[slot=table-resizable-container]:overflow-auto",
	inner: (bleed: boolean | undefined) => [
		"inline-block min-w-full align-middle",
		!bleed && "sm:px-(--gutter)",
	],
	columnResizer:
		"absolute top-0 right-0 bottom-0 grid w-px &[data-resizable-direction=left]:cursor-e-resize &[data-resizable-direction=right]:cursor-w-resize touch-none place-content-center px-1 data-[resizable-direction=both]:cursor-ew-resize [&[data-resizing]>div]:bg-primary",
	columnResizerLine: "h-full w-px bg-border py-(--gutter-y)",
	column: ({
		bleed,
		grid,
		isResizable,
	}: {
		bleed: boolean | undefined
		grid: boolean | undefined
		isResizable: boolean
	}) => [
		"text-left font-medium text-muted-fg",
		"relative allows-sorting:cursor-default outline-hidden data-dragging:cursor-grabbing",
		"px-4 py-(--gutter-y)",
		"first:pl-(--gutter,--spacing(2)) last:pr-(--gutter,--spacing(2))",
		!bleed && "sm:last:pr-1 sm:first:pl-1",
		grid && "border-l first:border-l-0",
		isResizable && "overflow-hidden truncate",
	],
	columnContent: ["inline-flex items-center gap-2 **:data-[slot=icon]:shrink-0"],
	sortIndicator: (isHovered: boolean) => [
		"grid size-[1.15rem] flex-none shrink-0 place-content-center rounded bg-secondary text-fg *:data-[slot=icon]:size-3.5 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:transition-transform *:data-[slot=icon]:duration-200",
		isHovered ? "bg-secondary-fg/10" : "",
	],
	sortIcon: (sortDirection: string | undefined) => (sortDirection === "ascending" ? "rotate-180" : ""),
	header: "border-b",
	utilityColumn: (bleed: boolean | undefined) => [
		"first:pl-(--gutter,--spacing(2))",
		!bleed && "sm:last:pr-1 sm:first:pl-1",
	],
	row: ({
		isSelected,
		isFocusVisible,
		isFocusVisibleWithin,
		isDragging,
		isDisabled,
		isActionable,
		striped,
	}: {
		isSelected: boolean
		isFocusVisible: boolean
		isFocusVisibleWithin: boolean
		isDragging: boolean
		isDisabled: boolean
		isActionable: boolean
		striped: boolean | undefined
	}) => [
		"group relative cursor-default text-muted-fg outline outline-transparent",
		isFocusVisible && "bg-primary/5 outline-primary ring-3 ring-ring/20 hover:bg-primary/10",
		isDragging && "cursor-grabbing bg-primary/10 text-fg outline-primary",
		isSelected && "bg-(--table-selected-bg) text-fg hover:bg-(--table-selected-bg)/50",
		striped && "even:bg-muted",
		isActionable && "hover:bg-(--table-selected-bg) hover:text-fg",
		isActionable &&
			isFocusVisibleWithin &&
			"bg-(--table-selected-bg)/50 selected:bg-(--table-selected-bg)/50 text-fg",
		isDisabled && "opacity-50",
	],
	dragCell: "px-0",
	dragButton:
		"grid place-content-center rounded-xs px-[calc(var(--gutter)/2)] outline-hidden focus-visible:ring focus-visible:ring-ring",
	cell: ({
		allowResize,
		bleed,
		grid,
		striped,
	}: {
		allowResize: boolean | undefined
		bleed: boolean | undefined
		grid: boolean | undefined
		striped: boolean | undefined
	}) => [
		"group px-4 py-(--gutter-y) align-middle outline-hidden first:pl-(--gutter,--spacing(2)) last:pr-(--gutter,--spacing(2)) group-has-data-focus-visible-within:text-fg",
		!striped && "border-b",
		grid && "border-l first:border-l-0",
		!bleed && "sm:last:pr-1 sm:first:pl-1",
		allowResize && "overflow-hidden truncate",
	],
}
