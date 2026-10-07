import { tv } from "tailwind-variants"

/** SplitPanel class composition, shared by the React and Foldkit apps. */

export const rootStyles = tv({
	base: "flex h-full w-full overflow-hidden",
})

export const contentStyles = tv({
	base: "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain",
})

export const panelStyles = tv({
	base: ["relative flex h-full flex-shrink-0 flex-col overflow-hidden", "border-border bg-bg"],
	variants: {
		position: {
			left: "border-r",
			right: "border-l",
		},
	},
	defaultVariants: {
		position: "right",
	},
})
