import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			text: ["display-xs", "display-sm", "display-md", "display-lg", "display-xl", "display-2xl"],
		},
	},
})

/**
 * This function is a wrapper around the twMerge function.
 * It is used to merge the classes inside style objects.
 */
export const cx = twMerge
