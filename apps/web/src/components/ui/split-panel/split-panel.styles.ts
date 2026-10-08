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

export const handleStyles = tv({
	base: [
		"absolute top-0 z-10 h-full w-1 cursor-col-resize",
		"bg-transparent transition-colors duration-150",
		"hover:bg-primary/20",
		"focus:outline-none focus-visible:bg-primary/30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
		"active:bg-primary/40",
	],
	variants: {
		position: {
			left: "right-0 translate-x-1/2",
			right: "left-0 -translate-x-1/2",
		},
		isDragging: {
			true: "bg-primary/40",
		},
	},
	defaultVariants: {
		position: "right",
		isDragging: false,
	},
})

export const indicatorStyles = tv({
	base: [
		"absolute top-1/2 h-8 w-1 -translate-y-1/2 rounded-full",
		"bg-border opacity-0 transition-opacity duration-150",
		"group-hover:opacity-100 group-focus-visible:opacity-100",
	],
	variants: {
		position: {
			left: "left-0",
			right: "left-0",
		},
		isDragging: {
			true: "opacity-100 bg-primary",
		},
	},
	defaultVariants: {
		position: "right",
		isDragging: false,
	},
})
