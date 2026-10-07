/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const popoverContentBase = [
	"group/popover min-w-(--trigger-width) max-w-xs origin-(--trigger-anchor-point) rounded-(--popover-radius) border border-fg/10 bg-overlay text-overlay-fg shadow-xs outline-hidden transition-transform [--gutter:--spacing(6)] [--popover-radius:var(--radius-xl)] sm:text-sm dark:backdrop-saturate-200 **:[[role=dialog]]:[--gutter:--spacing(6)]",
	"entering:fade-in exiting:fade-out entering:animate-in exiting:animate-out",
	"placement-left:entering:slide-in-from-right-1 placement-right:entering:slide-in-from-left-1 placement-top:entering:slide-in-from-bottom-1 placement-bottom:entering:slide-in-from-top-1",
	"placement-left:exiting:slide-out-to-right-1 placement-right:exiting:slide-out-to-left-1 placement-top:exiting:slide-out-to-bottom-1 placement-bottom:exiting:slide-out-to-top-1",
	"forced-colors:bg-[Canvas]",
] as const

export const popoverArrowClassName =
	"block fill-overlay stroke-border group-placement-bottom:rotate-180 group-placement-left:-rotate-90 group-placement-right:rotate-90 forced-colors:fill-[Canvas] forced-colors:stroke-[ButtonBorder]"

export const popoverInnerClassName = "max-h-[inherit] overflow-y-auto"

/** Merged with the footer's `className` by `twMerge`. */
export const popoverFooterBase = "justify-start has-[button]:justify-end"
