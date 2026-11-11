import { tv } from "tailwind-variants"

export type Sides = "top" | "bottom" | "left" | "right"
/**
 * A floating panel keeps 0.5rem from the screen's edges, more where the system draws over them
 * (the status bar, the home indicator: `env(safe-area-inset-*)`, 0 unless the page runs edge to
 * edge). An edge panel runs under them and pads its content clear instead.
 */
const generateCompoundVariants = (sides: Array<Sides>) => {
	return sides.flatMap((side) => [
		{
			side,
			isFloat: true,
			className:
				side === "top"
					? "top-[max(0.5rem,env(safe-area-inset-top))] inset-x-2 rounded-lg ring-1 border-b-0"
					: side === "bottom"
						? "bottom-[max(0.5rem,env(safe-area-inset-bottom))] inset-x-2 rounded-lg ring-1 border-t-0"
						: side === "left"
							? "left-2 top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] rounded-lg ring-1 border-r-0"
							: "right-2 top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] rounded-lg ring-1 border-l-0",
		},
		{
			side,
			isFloat: false,
			className:
				side === "top"
					? "pt-[env(safe-area-inset-top)]"
					: side === "bottom"
						? "pb-[env(safe-area-inset-bottom)]"
						: side === "left"
							? "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
							: "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]",
		},
	])
}

/** The panel slides in from its side and the backdrop fades, both from `@starting-style` (200ms). */
export const sheetContentStyles = tv({
	base: [
		"fixed z-50 grid gap-4 border-muted-fg/20 bg-overlay text-overlay-fg shadow-lg dark:border-border",
		"transform-gpu transition-[opacity,translate] duration-200 ease-out starting:opacity-0",
	],
	variants: {
		side: {
			top: "inset-x-0 top-0 rounded-b-2xl border-b starting:-translate-y-full",
			bottom: "inset-x-0 bottom-0 rounded-t-2xl border-t starting:translate-y-full",
			left: "inset-y-0 left-0 h-auto w-3/4 overflow-y-auto border-r starting:-translate-x-full sm:max-w-80",
			right: "inset-y-0 right-0 h-auto w-3/4 overflow-y-auto border-l starting:translate-x-full sm:max-w-80",
		},
		isFloat: {
			false: "border-fg/20 dark:border-border",
			true: "ring-fg/5 dark:ring-border",
		},
	},
	compoundVariants: generateCompoundVariants(["top", "bottom", "left", "right"]),
})

export const sheetBackdropClassName =
	"fixed inset-0 h-dvh w-screen overflow-hidden bg-overlay-backdrop transition-opacity duration-200 ease-out starting:opacity-0"

export const sheetCloseIconClassName = "top-2.5 right-2.5"
