import { tv } from "tailwind-variants"

/**
 * A key cap: one key of a shortcut, drawn as a small raised key (a hairline edge, heavier at the
 * bottom, seated by the resting shadow). `keyboard.styles.ts` is the other thing: the quiet shortcut
 * text at the end of a menu item.
 */
export const kbdStyles = tv({
	base: "inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm border border-border border-b-border-hover bg-bg font-medium font-sans text-fg-3 shadow-xs",
	variants: {
		size: {
			sm: "h-4.5 min-w-4.5 px-1 text-3xs",
			md: "h-5.5 min-w-5.5 px-1.5 text-2xs",
		},
	},
	defaultVariants: { size: "md" },
})
