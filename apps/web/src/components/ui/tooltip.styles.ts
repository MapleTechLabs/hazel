import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const tooltipStyles = tv({
	base: [
		"group max-w-sm origin-(--trigger-anchor-point) rounded-lg border border-(--tooltip-border) px-2.5 py-1.5 text-sm/6 will-change-transform [--tooltip-border:var(--color-muted-fg)]/30 dark:shadow-none *:[strong]:font-medium",
	],
	variants: {
		inverse: {
			true: ["border-transparent bg-fg text-bg", "**:[.text-muted-fg]:text-bg/60"],
			false: "bg-overlay text-overlay-fg",
		},
		isEntering: {
			true: [
				"fade-in animate-in",
				"placement-left:slide-in-from-right-1 placement-right:slide-in-from-left-1 placement-top:slide-in-from-bottom-1 placement-bottom:slide-in-from-top-1",
			],
		},
		isExiting: {
			true: [
				"fade-in direction-reverse animate-in",
				"placement-left:slide-out-to-right-1 placement-right:slide-out-to-left-1 placement-top:slide-out-to-bottom-1 placement-bottom:slide-out-to-top-1",
			],
		},
	},
	defaultVariants: {
		inverse: false,
	},
})

/** Arrow classes, joined by `twJoin` with the inverse or default fill. */
export const tooltipArrowBase =
	"block group-placement-bottom:rotate-180 group-placement-left:-rotate-90 group-placement-right:rotate-90 forced-colors:fill-[Canvas] forced-colors:stroke-[ButtonBorder]"
export const tooltipArrowInverse = "fill-fg stroke-transparent"
export const tooltipArrowDefault = "fill-overlay stroke-(--tooltip-border)"
