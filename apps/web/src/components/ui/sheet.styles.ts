import { twJoin } from "tailwind-merge"
import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
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

export const sheetContentStyles = tv({
	base: [
		"fixed z-50 grid gap-4 border-muted-fg/20 bg-overlay text-overlay-fg shadow-lg dark:border-border",
		"transform-gpu transition ease-in-out will-change-transform",
	],
	variants: {
		isEntering: {
			true: "fade-in animate-in duration-500",
		},
		isExiting: {
			true: "fade-in animate-out duration-300",
		},
		side: {
			top: "entering:slide-in-from-top exiting:slide-out-to-top inset-x-0 top-0 rounded-b-2xl border-b",
			bottom: "entering:slide-in-from-bottom exiting:slide-out-to-bottom inset-x-0 bottom-0 rounded-t-2xl border-t",
			left: "entering:slide-in-from-left exiting:slide-out-to-left-80 inset-y-0 left-0 h-auto w-3/4 overflow-y-auto border-r sm:max-w-80",
			right: "entering:slide-in-from-right exiting:slide-out-to-right-80 inset-y-0 right-0 h-auto w-3/4 overflow-y-auto border-l sm:max-w-80",
		},
		isFloat: {
			false: "border-fg/20 dark:border-border",
			true: "ring-fg/5 dark:ring-border",
		},
	},
	compoundVariants: generateCompoundVariants(["top", "bottom", "left", "right"]),
})

export const sheetOverlayClassName = (isEntering: boolean, isExiting: boolean, isBlurred: boolean) =>
	twJoin(
		"fixed inset-0 z-50 h-(--visual-viewport-height,100vh) w-screen overflow-hidden bg-overlay-backdrop",
		isEntering && "fade-in animate-in duration-500",
		isExiting && "fade-out animate-out duration-300",
		isBlurred && "backdrop-blur-sm backdrop-filter",
	)

export const sheetCloseIconClassName = "top-2.5 right-2.5"
