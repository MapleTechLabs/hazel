import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const menuTriggerBase = [
	"relative inline text-left outline-hidden focus-visible:ring-1 focus-visible:ring-primary",
	"*:data-[slot=chevron]:size-5 sm:*:data-[slot=chevron]:size-4",
] as const

export const menuContentStyles = tv({
	base: "grid max-h-[inherit] grid-cols-[auto_1fr] overflow-y-auto overflow-x-hidden overscroll-contain p-1 outline-hidden [clip-path:inset(0_0_0_0_round_calc(var(--radius-xl)-(--spacing(1))))] *:[[role='group']+[role=group]]:mt-1 *:[[role='group']+[role=separator]]:mt-1",
})

/** Popover classes for a menu, merged with `popover.className` by `cx`. */
export const menuPopoverBase = "min-w-32"

/** Extra item classes while an item's submenu is open, per intent. */
export const menuItemSubmenuOpen = {
	danger: "open:bg-danger-subtle open:text-danger-subtle-fg",
	warning: "open:bg-warning-subtle open:text-warning-subtle-fg",
	none: "open:bg-accent open:text-accent-fg open:*:data-[slot=icon]:text-accent-fg open:*:[.text-muted-fg]:text-accent-fg",
} as const

export const menuChevronClassName = "absolute right-2 size-3.5"

export const menuHeaderBase = "col-span-full px-2.5 py-2 font-medium text-base sm:text-sm"
export const menuHeaderSeparator = "-mx-1 mb-1 border-b sm:px-3 sm:pb-[0.625rem]"
