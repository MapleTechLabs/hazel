import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const validationStateStyles = tv({
	base: "absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center",
	variants: {
		state: {
			idle: "hidden",
			validating: "text-muted-fg animate-spin",
			valid: "text-success-fg",
			invalid: "text-danger-subtle-fg",
		},
	},
	defaultVariants: {
		state: "idle",
	},
})

/** Size of each state icon. */
export const validationStateIconStyles = "size-4"
