import { tv } from "tailwind-variants"

export type Sides = "top" | "bottom" | "left" | "right"
const generateCompoundVariants = (sides: Array<Sides>) => {
	return sides.map((side) => ({
		side,
		isFloat: true,
		className:
			side === "top"
				? "top-2 inset-x-2 rounded-lg ring-1 border-b-0"
				: side === "bottom"
					? "bottom-2 inset-x-2 rounded-lg ring-1 border-t-0"
					: side === "left"
						? "left-2 inset-y-2 rounded-lg ring-1 border-r-0"
						: "right-2 inset-y-2 rounded-lg ring-1 border-l-0",
	}))
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
