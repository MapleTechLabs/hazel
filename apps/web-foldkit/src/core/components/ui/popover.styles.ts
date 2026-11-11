/**
 * Popover panel classes, merged with the caller's `className`. Anchor writes `data-placement`
 * (top|bottom|left|right) and `--button-width`; the panel fades in from `@starting-style` (150ms).
 */
export const popoverContentBase = [
	"group/popover z-50 min-w-(--trigger-width) max-w-xs rounded-(--popover-radius) border border-fg/10 bg-overlay text-overlay-fg shadow-xs outline-hidden [--gutter:--spacing(6)] [--popover-radius:var(--radius-xl)] sm:text-sm dark:backdrop-saturate-200 **:[[role=dialog]]:[--gutter:--spacing(6)]",
	"flex flex-col transition-opacity duration-150 ease-out starting:opacity-0",
	"forced-colors:bg-[Canvas]",
] as const

/** The click-outside backdrop: transparent, under the panel. */
export const popoverBackdropClassName = "fixed inset-0 z-40"

/** The arrow sits outside the panel edge facing the trigger, at Anchor's `--arrow-x`/`--arrow-y`. */
export const popoverArrowClassName = [
	"absolute block left-(--arrow-x) top-(--arrow-y) fill-overlay stroke-border",
	"group-data-[placement=top]/popover:top-full",
	"group-data-[placement=bottom]/popover:bottom-full group-data-[placement=bottom]/popover:rotate-180",
	"group-data-[placement=left]/popover:left-full group-data-[placement=left]/popover:-rotate-90",
	"group-data-[placement=right]/popover:right-full group-data-[placement=right]/popover:rotate-90",
	"forced-colors:fill-[Canvas] forced-colors:stroke-[ButtonBorder]",
].join(" ")

export const popoverInnerClassName = "min-h-0 flex-1 overflow-y-auto outline-hidden"

/** Merged with the footer's `className` by `twMerge`. */
export const popoverFooterBase = "justify-start has-[button]:justify-end"
