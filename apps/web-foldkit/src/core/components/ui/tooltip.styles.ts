import { tv } from "tailwind-variants"

/**
 * The panel fades and slides in from the trigger as it mounts (`starting:`, @starting-style). The
 * slide follows the requested `side`: Anchor writes the resolved side to `data-placement` only
 * after the first position, too late for the starting style.
 */
export const tooltipStyles = tv({
	base: [
		"group z-50 max-w-sm rounded-lg border border-(--tooltip-border) px-2.5 py-1.5 text-sm/6 [--tooltip-border:var(--color-muted-fg)]/30 dark:shadow-none *:[strong]:font-medium",
		"transition-[opacity,translate] duration-150 ease-out starting:opacity-0",
	],
	variants: {
		inverse: {
			true: ["border-transparent bg-fg text-bg", "**:[.text-muted-fg]:text-bg/60"],
			false: "bg-overlay text-overlay-fg",
		},
		side: {
			top: "starting:translate-y-1",
			bottom: "starting:-translate-y-1",
			left: "starting:translate-x-1",
			right: "starting:-translate-x-1",
		},
	},
	defaultVariants: {
		inverse: false,
		side: "top",
	},
})

/**
 * Arrow classes, joined by `twJoin` with the inverse or default fill. The arrow sits outside the
 * panel edge facing the trigger, at the `--arrow-x`/`--arrow-y` offset Anchor publishes, and the
 * side comes from the panel's `data-placement`.
 */
export const tooltipArrowBase = [
	"absolute block left-(--arrow-x) top-(--arrow-y)",
	"group-data-[placement=top]:top-full",
	"group-data-[placement=bottom]:bottom-full group-data-[placement=bottom]:rotate-180",
	"group-data-[placement=left]:left-full group-data-[placement=left]:-rotate-90",
	"group-data-[placement=right]:right-full group-data-[placement=right]:rotate-90",
	"forced-colors:fill-[Canvas] forced-colors:stroke-[ButtonBorder]",
].join(" ")
export const tooltipArrowInverse = "fill-fg stroke-transparent"
export const tooltipArrowDefault = "fill-overlay stroke-(--tooltip-border)"
